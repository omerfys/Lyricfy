# High-performance persistent WinRT GSMTC daemon with Zero-Freeze Timeline & Lossless Base64 UTF-8 Pipe
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' 
})[0]

function Await-WinRt($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    if (-not $netTask.Wait(150)) { return $null }
    return $netTask.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$mgr = Await-WinRt ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

# Per-session hardware edge-triggered position tracker & metadata cache
# Supports both Spotify (periodic 4s GSMTC ticks) and Chromium/YouTube Music (event-only GSMTC ticks on Play/Pause/Seek)
$sessionTrackers = @{}
$mediaCache = @{}
$isInitialBoot = $true
$loopTick = 0

while ($true) {
    $loopTick++
    try {
        $nowOffset = [DateTimeOffset]::UtcNow
        $nowMs = $nowOffset.ToUnixTimeMilliseconds()
        $sessions = $mgr.GetSessions()
        $currentSession = $mgr.GetCurrentSession()
        $currentAppId = if ($currentSession) { $currentSession.SourceAppUserModelId } else { "" }

        $output = @()
        $sessionIdx = 0

        foreach ($s in $sessions) {
            $sessionIdx++
            try {
                # 1. Read synchronous PlaybackInfo & TimelineProperties FIRST (0ms in-memory WinRT calls)
                # This ensures Pause/Stop transitions are detected instantaneously without waiting on COM IPC
                $playback = $s.GetPlaybackInfo()
                $timeline = $s.GetTimelineProperties()
                $appId = if ($s.SourceAppUserModelId) { $s.SourceAppUserModelId } else { "unknown" }

                $statusStr = if ($playback -and $playback.PlaybackStatus) { $playback.PlaybackStatus.ToString() } else { "Paused" }
                $rawPos = $timeline.Position.TotalSeconds
                $durSec = $timeline.EndTime.TotalSeconds
                $lastUpdMs = if ($timeline.LastUpdatedTime -and $timeline.LastUpdatedTime.Year -gt 2020) {
                    $timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
                } else {
                    0
                }

                # 2. Smart Media Properties Cache: never block a Playing -> Paused transition on async COM IPC
                $slotKey = "$sessionIdx|$appId"
                $cached = $mediaCache[$slotKey]
                $needMediaRefresh = $false

                if (-not $cached) {
                    $needMediaRefresh = $true
                } elseif ($statusStr -eq 'Playing') {
                    if (($durSec -ne $cached.LastDurSec) -or ($lastUpdMs -ne $cached.LastUpdMs) -or ($statusStr -ne $cached.LastStatus) -or (($loopTick - $cached.LastFetchTick) -ge 6)) {
                        $needMediaRefresh = $true
                    }
                } else {
                    # While Paused/Stopped, skip COM IPC on the exact transition frame so pause emits in <1ms!
                    if (($statusStr -eq $cached.LastStatus) -and (($loopTick - $cached.LastFetchTick) -ge 20)) {
                        $needMediaRefresh = $true
                    }
                }

                if ($needMediaRefresh) {
                    $media = Await-WinRt ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
                    if ($media -and $media.Title) {
                        $cached = @{
                            Title = $media.Title
                            Artist = $media.Artist
                            Album = $media.AlbumTitle
                            LastDurSec = $durSec
                            LastUpdMs = $lastUpdMs
                            LastStatus = $statusStr
                            LastFetchTick = $loopTick
                        }
                        $mediaCache[$slotKey] = $cached
                    }
                    # Re-read synchronous PlaybackInfo right after async COM call in case user paused during IPC
                    $playbackAfter = $s.GetPlaybackInfo()
                    if ($playbackAfter -and $playbackAfter.PlaybackStatus) {
                        $statusStr = $playbackAfter.PlaybackStatus.ToString()
                    }
                } elseif ($cached) {
                    $cached.LastStatus = $statusStr
                }

                if (-not $cached -or -not $cached.Title) { continue }
                $title = $cached.Title
                $artist = $cached.Artist
                $album = $cached.Album

                $sessionKey = "$appId|$title|$artist"
                $isNewOrReturnedTrack = (-not $sessionTrackers.ContainsKey($sessionKey)) -or (($loopTick - $sessionTrackers[$sessionKey].LastSeenTick) -gt 4)

                if ($isNewOrReturnedTrack) {
                    $initPos = $rawPos
                    $initAge = if ($timeline.LastUpdatedTime -and $timeline.LastUpdatedTime.Year -gt 2020) {
                        ($nowOffset - $timeline.LastUpdatedTime).TotalSeconds
                    } else {
                        999999
                    }

                    if (-not $isInitialBoot) {
                        # Track just switched live while daemon is running!
                        # If LastUpdatedTime is older than 1.5s, timeline still holds the previous song's stale state!
                        if ($initAge -le 1.5 -and $rawPos -ge 0 -and $rawPos -lt 10.0) {
                            $initPos = if ($statusStr -eq 'Playing') { $rawPos + [Math]::Max(0, $initAge) } else { $rawPos }
                        } else {
                            $initPos = 0.0
                        }
                    } else {
                        # Daemon just started while song was already playing mid-track: reconstruct true elapsed position
                        if ($statusStr -eq 'Playing' -and $initAge -ge 0 -and ($durSec -le 0 -or ($rawPos + $initAge) -le ($durSec + 10.0))) {
                            $initPos = $rawPos + $initAge
                        }
                    }

                    $sessionTrackers[$sessionKey] = @{
                        LastRawPos = $rawPos
                        LastUpdMs = $lastUpdMs
                        AnchorPos = $initPos
                        AnchorTime = $nowOffset
                        LastStatus = $statusStr
                        LastSeenTick = $loopTick
                        TrackSwitchedAtMs = if ($isInitialBoot) { $lastUpdMs } else { $nowMs }
                    }
                }

                $tracker = $sessionTrackers[$sessionKey]
                $tracker.LastSeenTick = $loopTick
                $rawPosChanged = ([Math]::Abs($rawPos - $tracker.LastRawPos) -gt 0.001)
                $updTimeChanged = ($lastUpdMs -gt 0 -and $lastUpdMs -ne $tracker.LastUpdMs)

                # Prioritize Play/Pause status transitions FIRST so pausing in Chromium/Spotify freezes immediately
                if ($statusStr -ne $tracker.LastStatus) {
                    if ($statusStr -eq 'Playing') {
                        # Resumed from pause
                        if ($rawPosChanged -and $rawPos -gt 0) {
                            $tracker.AnchorPos = $rawPos
                        }
                        $tracker.AnchorTime = $nowOffset
                    } else {
                        # Paused or Stopped: freeze AnchorPos at the exact moment of pause
                        $elapsedBeforePause = [Math]::Max(0, ($nowOffset - $tracker.AnchorTime).TotalSeconds)
                        $frozenPos = $tracker.AnchorPos + $elapsedBeforePause
                        if ($rawPosChanged -and $rawPos -gt 0 -and ([Math]::Abs($rawPos - $frozenPos) -lt 1.5)) {
                            $tracker.AnchorPos = $rawPos
                        } else {
                            $tracker.AnchorPos = $frozenPos
                        }
                        $tracker.AnchorTime = $nowOffset
                    }
                    $tracker.LastRawPos = $rawPos
                    $tracker.LastUpdMs = $lastUpdMs
                    $tracker.LastStatus = $statusStr
                    $posSec = $tracker.AnchorPos
                } elseif ($rawPosChanged -or $updTimeChanged) {
                    if ($statusStr -eq 'Playing') {
                        # Hardware position or seek timestamp updated while playing
                        $newAnchorPos = $rawPos
                        if ($timeline.LastUpdatedTime -and $timeline.LastUpdatedTime.Year -gt 2020) {
                            $tickAge = ($nowOffset - $timeline.LastUpdatedTime).TotalSeconds
                            if ($tickAge -ge 0 -and $tickAge -le 3.0) {
                                $newAnchorPos = $rawPos + $tickAge
                            }
                        }
                        $tracker.AnchorPos = $newAnchorPos
                        $tracker.AnchorTime = $nowOffset
                    } elseif ($rawPosChanged) {
                        # User scrubbed seekbar while paused
                        $tracker.AnchorPos = $rawPos
                        $tracker.AnchorTime = $nowOffset
                    }
                    $tracker.LastRawPos = $rawPos
                    $tracker.LastUpdMs = $lastUpdMs
                    $posSec = $tracker.AnchorPos
                } elseif ($statusStr -eq 'Playing') {
                    # Continuous 1.0x real-time advancement (never freezes after 8s in YouTube Music!)
                    $elapsedSinceAnchor = ($nowOffset - $tracker.AnchorTime).TotalSeconds
                    if ($elapsedSinceAnchor -ge 0) {
                        $posSec = $tracker.AnchorPos + $elapsedSinceAnchor
                    } else {
                        $posSec = $tracker.AnchorPos
                    }
                } else {
                    # Paused or Stopped
                    $posSec = $tracker.AnchorPos
                }

                if ($durSec -gt 0 -and $posSec -gt $durSec) {
                    $posSec = $durSec
                }

                $detectedSource = "youtube"
                $appLower = "$appId".ToLower()
                $combined = "$appId $album $artist $title".ToLower()

                if ($appLower -match 'spotify' -or $combined -match 'spotify') {
                    $detectedSource = "spotify"
                } elseif ($combined -match 'youtube|yt music' -or $appLower -match 'chrome|msedge|firefox|opera|brave|vivaldi|dia|thebrowsercompany|arc|zen|waterfox|floorp|yandex|whale|thorium|chromium|librewolf') {
                    $detectedSource = "youtube"
                }

                $isCurrentSession = [bool]($currentAppId -and ($appId -eq $currentAppId))
                $effectiveLastUpdMs = [Math]::Max($lastUpdMs, $tracker.TrackSwitchedAtMs)

                $output += [PSCustomObject]@{
                    AppId = $appId
                    Title = $title
                    Artist = $artist
                    Album = $album
                    Source = $detectedSource
                    Status = $statusStr
                    PositionSeconds = [Math]::Round($posSec, 3)
                    DurationSeconds = $durSec
                    IsCurrent = $isCurrentSession
                    LastUpdatedMs = $effectiveLastUpdMs
                    ServerTimeMs = $nowMs
                }
            } catch {}
        }

        $isInitialBoot = $false

        if ($output.Count -gt 0) {
            if ($output.Count -eq 1) {
                $json = "[" + ($output[0] | ConvertTo-Json -Compress) + "]"
            } else {
                $json = $output | ConvertTo-Json -Compress
            }
        } else {
            $json = "[]"
        }

        # Lossless Base64 UTF-8 transport so Turkish characters (ğ, ü, ş, ı, ö, ç, İ) never corrupt over headless pipes
        $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
        [Console]::Out.WriteLine("B64:$b64")
        [Console]::Out.Flush()
    } catch {
        # ignore loop error
    }

    Start-Sleep -Milliseconds 25
}

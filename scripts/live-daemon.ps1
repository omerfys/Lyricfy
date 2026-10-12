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
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$mgr = Await-WinRt ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

# Per-session hardware edge-triggered position tracker
# Supports both Spotify (periodic 4s GSMTC ticks) and Chromium/YouTube Music (event-only GSMTC ticks on Play/Pause/Seek)
$sessionTrackers = @{}
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

        foreach ($s in $sessions) {
            try {
                $media = Await-WinRt ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
                $timeline = $s.GetTimelineProperties()
                $playback = $s.GetPlaybackInfo()

                $title = $media.Title
                if (-not $title) { continue }
                $artist = $media.Artist
                $album = $media.AlbumTitle
                $appId = if ($s.SourceAppUserModelId) { $s.SourceAppUserModelId } else { "unknown" }

                $statusStr = $playback.PlaybackStatus.ToString()
                $rawPos = $timeline.Position.TotalSeconds
                $durSec = $timeline.EndTime.TotalSeconds
                $lastUpdMs = if ($timeline.LastUpdatedTime -and $timeline.LastUpdatedTime.Year -gt 2020) {
                    $timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
                } else {
                    0
                }

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
                            $initPos = $rawPos + [Math]::Max(0, $initAge)
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

                if ($rawPosChanged -or $updTimeChanged) {
                    # Hardware position or seek timestamp updated!
                    $newAnchorPos = $rawPos
                    if ($statusStr -eq 'Playing' -and $timeline.LastUpdatedTime -and $timeline.LastUpdatedTime.Year -gt 2020) {
                        $tickAge = ($nowOffset - $timeline.LastUpdatedTime).TotalSeconds
                        if ($tickAge -ge 0 -and $tickAge -le 3.0) {
                            $newAnchorPos = $rawPos + $tickAge
                        }
                    }
                    $tracker.LastRawPos = $rawPos
                    $tracker.LastUpdMs = $lastUpdMs
                    $tracker.AnchorPos = $newAnchorPos
                    $tracker.AnchorTime = $nowOffset
                    $tracker.LastStatus = $statusStr
                    $posSec = $newAnchorPos
                } elseif ($statusStr -ne $tracker.LastStatus) {
                    # Play/Pause state changed without position change
                    if ($statusStr -eq 'Playing') {
                        # Resumed from pause
                        $tracker.AnchorTime = $nowOffset
                    } else {
                        # Paused: freeze AnchorPos at the exact moment of pause
                        $elapsedBeforePause = ($nowOffset - $tracker.AnchorTime).TotalSeconds
                        if ($elapsedBeforePause -ge 0) {
                            $tracker.AnchorPos = $tracker.AnchorPos + $elapsedBeforePause
                        }
                        $tracker.AnchorTime = $nowOffset
                    }
                    $tracker.LastStatus = $statusStr
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
                $effectiveStatus = if ($statusStr -in @('Changing', 'Opened')) { 'Playing' } else { $statusStr }

                $output += [PSCustomObject]@{
                    AppId = $appId
                    Title = $title
                    Artist = $artist
                    Album = $album
                    Source = $detectedSource
                    Status = $effectiveStatus
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

# High-performance persistent WinRT GSMTC daemon with Edge-Triggered Zero-Latency Timeline
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
$mgr = Await-WinRt ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

# Per-session hardware edge-triggered position tracker
# Prevents 2x speed double-counting while eliminating 4-second Spotify GSMTC freezes
$sessionTrackers = @{}

# Real-time loop (runs every 60ms)
while ($true) {
    try {
        $nowOffset = [DateTimeOffset]::UtcNow
        $nowMs = $nowOffset.ToUnixTimeMilliseconds()
        $sessions = $mgr.GetSessions()
        $currentSession = $mgr.GetCurrentSession()
        $currentAppId = if ($currentSession) { $currentSession.SourceAppUserModelId } else { "" }

        $output = @()

        foreach ($s in $sessions) {
            try {
                [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
                $media = Await-WinRt ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
                $timeline = $s.GetTimelineProperties()
                $playback = $s.GetPlaybackInfo()

                $title = $media.Title
                $artist = $media.Artist
                $album = $media.AlbumTitle
                $appId = $s.SourceAppUserModelId

                $statusStr = $playback.PlaybackStatus.ToString()
                $rawPos = $timeline.Position.TotalSeconds
                $durSec = $timeline.EndTime.TotalSeconds
                $lastUpdMs = if ($timeline.LastUpdatedTime -and $timeline.LastUpdatedTime.Year -gt 2020) {
                    $timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
                } else {
                    0
                }

                $sessionKey = "$appId|$title|$artist"

                if (-not $sessionTrackers.ContainsKey($sessionKey)) {
                    # Initial discovery of this track session
                    $initPos = $rawPos
                    if ($statusStr -eq 'Playing' -and $timeline.LastUpdatedTime -and $timeline.LastUpdatedTime.Year -gt 2020) {
                        $initAge = ($nowOffset - $timeline.LastUpdatedTime).TotalSeconds
                        # Only add initial age if it's a recent Spotify snapshot (< 6s)
                        if ($initAge -ge 0 -and $initAge -le 6.0) {
                            $initPos = $rawPos + $initAge
                        }
                    }
                    $sessionTrackers[$sessionKey] = @{
                        LastRawPos = $rawPos
                        AnchorPos = $initPos
                        AnchorTime = $nowOffset
                        LastStatus = $statusStr
                    }
                }

                $tracker = $sessionTrackers[$sessionKey]

                if ([Math]::Abs($rawPos - $tracker.LastRawPos) -gt 0.001) {
                    # Hardware position just updated! Lock directly onto the new exact position
                    $tracker.LastRawPos = $rawPos
                    $tracker.AnchorPos = $rawPos
                    $tracker.AnchorTime = $nowOffset
                    $tracker.LastStatus = $statusStr
                    $posSec = $rawPos
                } elseif ($statusStr -ne $tracker.LastStatus) {
                    # Play/Pause state changed without position change
                    $tracker.LastStatus = $statusStr
                    $tracker.AnchorTime = $nowOffset
                    $posSec = $tracker.AnchorPos
                } elseif ($statusStr -eq 'Playing') {
                    # Smooth 1.0x real-time advancement while waiting for next GSMTC position tick
                    $elapsedSinceAnchor = ($nowOffset - $tracker.AnchorTime).TotalSeconds
                    if ($elapsedSinceAnchor -ge 0 -and $elapsedSinceAnchor -le 8.0) {
                        $posSec = $tracker.AnchorPos + $elapsedSinceAnchor
                    } else {
                        $posSec = $rawPos
                    }
                } else {
                    # Paused or Stopped
                    $posSec = $tracker.AnchorPos
                }

                if ($durSec -gt 0 -and $posSec -gt $durSec) {
                    $posSec = $durSec
                }

                $detectedSource = "other"
                $appLower = "$appId".ToLower()
                $combined = "$appId $album $artist $title".ToLower()

                if ($appLower -match 'spotify' -or $combined -match 'spotify') {
                    $detectedSource = "spotify"
                } elseif ($combined -match 'youtube' -or $appLower -match 'chrome|msedge|firefox|opera|brave|vivaldi') {
                    $detectedSource = "youtube"
                }

                $isCurrentSession = [bool]($currentAppId -and ($appId -eq $currentAppId))

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
                    LastUpdatedMs = $lastUpdMs
                    ServerTimeMs = $nowMs
                }
            } catch {}
        }

        if ($output.Count -gt 0) {
            if ($output.Count -eq 1) {
                $json = "[" + ($output[0] | ConvertTo-Json -Compress) + "]"
            } else {
                $json = $output | ConvertTo-Json -Compress
            }
            [Console]::Out.WriteLine($json)
            [Console]::Out.Flush()
        } else {
            [Console]::Out.WriteLine('[]')
            [Console]::Out.Flush()
        }
    } catch {
        # ignore loop error
    }

    Start-Sleep -Milliseconds 60
}

# Windows Media Query with Spotify & YouTube Music detection
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

# Check running processes with window titles
$openWindows = @()
try {
    $openWindows = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object ProcessName, MainWindowTitle
} catch {}

$isSpotifyRunning = ($openWindows | Where-Object { $_.ProcessName -match 'Spotify' }).Count -gt 0
$isYtMusicWindow = ($openWindows | Where-Object { $_.MainWindowTitle -match 'YouTube Music|YouTube' }).Count -gt 0

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$mgr = Await-WinRt ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

$sessions = $mgr.GetSessions()
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
        $appId = $s.SourceAppId

        # Detect source category (spotify, youtube, other)
        $detectedSource = "other"
        $combinedText = "$appId $album $artist $title".ToLower()

        if ($combinedText -match 'spotify' -or $isSpotifyRunning -and ($appId -match 'spotify' -or $album -notmatch 'youtube')) {
            # Check if this session is likely Spotify
            if ($appId -match 'spotify' -or $album -match 'spotify' -or $combinedText -match 'spotify') {
                $detectedSource = "spotify"
            }
        }
        
        if ($combinedText -match 'youtube' -or $album -match 'youtube' -or $appId -match 'youtube' -or ($isYtMusicWindow -and $detectedSource -eq "other")) {
            $detectedSource = "youtube"
        }

        # If Spotify is playing and title is valid, and not youtube
        if ($detectedSource -eq "other" -and $isSpotifyRunning -and $album -notmatch 'youtube') {
            $detectedSource = "spotify"
        }

        $output += [PSCustomObject]@{
            AppId = $appId
            Title = $title
            Artist = $artist
            Album = $album
            Source = $detectedSource
            Status = $playback.PlaybackStatus.ToString()
            PositionSeconds = $timeline.Position.TotalSeconds
            DurationSeconds = $timeline.EndTime.TotalSeconds
        }
    } catch {
        # ignore session read errors
    }
}

if ($output.Count -eq 0) {
    Write-Host '{"status":"empty","sessions":[]}'
} else {
    Write-Host ($output | ConvertTo-Json -Compress)
}

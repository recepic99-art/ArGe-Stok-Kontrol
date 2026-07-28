$noBrowser = $args -contains "-NoBrowser"
$ErrorActionPreference = "Stop"

$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$listener = $null
$port = 4173

while ($port -le 4190) {
    try {
        $listener = [System.Net.Sockets.TcpListener]::new(
            [System.Net.IPAddress]::Loopback,
            $port
        )
        $listener.Start()
        break
    }
    catch {
        if ($listener) {
            $listener.Stop()
            $listener = $null
        }
        $port += 1
    }
}

if (-not $listener) {
    Write-Host "Uygun bir yerel port bulunamadi."
    Read-Host "Kapatmak icin Enter"
    exit 1
}

$url = "http://127.0.0.1:$port/"
Write-Host "Ar-Ge Numune Depo Web Demo"
Write-Host "Adres: $url"
Write-Host "Sunucuyu kapatmak icin bu pencereyi kapatin."

if (-not $noBrowser) {
    $browserCandidates = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
    )
    $browser = $browserCandidates | Where-Object {
        $_ -and [System.IO.File]::Exists($_)
    } | Select-Object -First 1

    if ($browser) {
        Start-Process -FilePath $browser -ArgumentList $url
    }
    else {
        Start-Process $url
    }
}

$contentTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            # Boş veya yarım kalan bir tarayıcı bağlantısı sunucunun tamamını kilitlemesin.
            $client.ReceiveTimeout = 3000
            $client.SendTimeout = 5000
            $stream.ReadTimeout = 3000
            $stream.WriteTimeout = 5000
            $reader = [System.IO.StreamReader]::new(
                $stream,
                [System.Text.Encoding]::ASCII,
                $false,
                1024,
                $true
            )

            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) {
                continue
            }

            $headerCount = 0
            while ($headerCount -lt 100) {
                $headerLine = $reader.ReadLine()
                if ([string]::IsNullOrEmpty($headerLine)) {
                    break
                }
                $headerCount += 1
            }

            $requestTarget = ($requestLine -split " ")[1]
            $requestPath = ($requestTarget -split "\?")[0]
            $relative = [System.Uri]::UnescapeDataString($requestPath.TrimStart("/"))
            if ([string]::IsNullOrWhiteSpace($relative)) {
                $relative = "index.html"
            }

            $status = "200 OK"
            $body = $null
            $contentType = "application/octet-stream"

            if ($requestPath -eq "/__health") {
                $body = [System.Text.Encoding]::UTF8.GetBytes("OK")
                $contentType = "text/plain; charset=utf-8"
            }
            else {
                $relative = $relative.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
                $target = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
            }

            if ($body) {
                # Sağlık kontrolü için dosya okuması yapılmaz.
            }
            elseif (-not $target.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
                $status = "403 Forbidden"
                $body = [System.Text.Encoding]::UTF8.GetBytes("Forbidden")
                $contentType = "text/plain; charset=utf-8"
            }
            elseif (-not [System.IO.File]::Exists($target)) {
                $status = "404 Not Found"
                $body = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
                $contentType = "text/plain; charset=utf-8"
            }
            else {
                $body = [System.IO.File]::ReadAllBytes($target)
                $extension = [System.IO.Path]::GetExtension($target).ToLowerInvariant()
                if ($contentTypes.ContainsKey($extension)) {
                    $contentType = $contentTypes[$extension]
                }
            }

            $header = "HTTP/1.1 $status`r`n" +
                "Content-Type: $contentType`r`n" +
                "Content-Length: $($body.Length)`r`n" +
                "Cache-Control: no-store`r`n" +
                "Connection: close`r`n`r`n"
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            $stream.Write($body, 0, $body.Length)
            $stream.Flush()
        }
        catch {
            # Hatalı veya yarım bir istek yalnızca kendi bağlantısını kapatır.
        }
        finally {
            $client.Close()
        }
    }
}
finally {
    $listener.Stop()
}

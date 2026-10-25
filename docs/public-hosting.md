# Free web sharing from this computer

The complete app runs on this Windows computer; a Cloudflare Quick Tunnel supplies an HTTPS URL. Video rendering, scanned PDF imports, comics, and downloads use the local backend. This is a demo deployment with no uptime guarantee. Keep the computer awake and online. No AI-provider credits are included in hosting.

## Start and stop

From the project folder, run `./scripts/Start-Public.ps1`. It builds the app, starts both processes in hidden windows, and prints the public URL. Use `-SkipBuild` only when the current sources have already been built. The running URL, process IDs, and logs are in `output/public-host/`.

Run `./scripts/Stop-Public.ps1` to stop sharing. It stops only the recorded processes after verifying their executable and start time. Files remain on disk.

Restarting the tunnel produces a **new hostname**. Browser keys and workspace cookies belong to the old hostname and do not move automatically. Save important downloads before restarting. Refreshing the same URL retains keys and access to the visitor's lessons.

## Runtime prerequisites

- Node and pnpm, plus project dependencies.
- `output/tools/cloudflared.exe`, downloaded from the official [Cloudflare releases](https://github.com/cloudflare/cloudflared/releases). Verify its Windows signature belongs to Cloudflare.
- A current Windows FFmpeg build extracted inside `output/tools/ffmpeg/`. Download from [Gyan's builds](https://www.gyan.dev/ffmpeg/builds/) and verify the archive against its published SHA-256 checksum before extracting. The launcher sets `FFMPEG_PATH`; the npm installer fallback dates from 2018 and must not be used for public uploads.
- `subway_surfers.mp4` at the repository root. It ships with the app and supplies the default short-form gameplay. Uploaded clips can override it.

The launcher does not load `.env`. It sets `PUBLIC_ORIGIN` to the tunnel URL and listens only on `127.0.0.1:3100`. Public projects use `output/public-lessons/`, separate from local projects in `output/lessons/`. No development server or arbitrary project files are published.

## Security and storage model

- Each public visitor receives a random 256-bit HttpOnly, SameSite=Strict, Secure cookie. Only a hash is saved alongside their lessons. All lesson reads, writes, downloads, exports, and PDF imports check ownership. Missing cookies cannot claim older projects. Clearing site data loses access; there is no account recovery or cross-device sync.
- API keys auto-save in the browser's local storage, are masked in the UI, and are shared across studios. They are not encrypted against someone with access to the same browser profile. The settings card has a clear-keys button. Keys are sent through HTTPS only for explicitly requested provider operations and are excluded from lesson files and exports. No owner API keys are supplied to public visitors.
- Production uses a content security policy without external scripts, cross-origin request checks, anti-framing and MIME-sniffing headers, private uncached assets, bounded uploads, and request/concurrency limits. These protections reduce risk; they do not certify the app as vulnerability-free. Keep dependencies and FFmpeg current.
- Rate limiting is conservative and shared by visitors arriving through the same local tunnel. This is intended for a small demo. It is not a multi-tenant production hosting platform.
- Generated work remains on this computer until removed. A temporary tunnel does not supply backups, guaranteed availability, or a stable URL. Use an authenticated named tunnel with a stable domain and managed storage for a permanent service.

Cloudflare documents Quick Tunnel behavior and limits in its [Quick Tunnels guide](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

# UIQLab Compose file

UITend uses UIQLab-X by Rui Feng (master's thesis, TU Chemnitz, 2026), based on
UIQLab by Heil, Liusnando and Gaedke (ICWE 2025), to calculate the metrics.
UIQLab is not part of this repository. Its source code is in Rui Feng's
repository on the GitLab instance of TU Chemnitz (UITend was run with commit
`a56f03a`) and in the digital appendix of the thesis (`02-source-code/uiqlab/`).

Before starting UIQLab, apply these changes in the UIQLab project
(`uitend-integration.diff`):

- Replace its `docker-compose.yml` with the file in this folder. Nginx joins
  the external network `thesis-network`, so the orchestrator reaches UIQLab
  at `http://nginx`. The Nginx host port is `8080` instead of `80`, and the
  database port is not published.
- Set `VITE_PREFIX_URL=http://localhost:8080/` in `frontend/.env`, so that the
  UIQLab web frontend uses the new port.

Start UIQLab before UITend:

```bash
docker network create thesis-network
cd ma-rui-feng-thesis-rui-feng
docker compose up --build -d
```

# Slurm Dashboard

A lightweight npm-powered dashboard for Slurm clusters. The Node backend shells out to standard Slurm tools and serves a static dashboard with queue, accounting, partition, node-state, and command-health views.

## Commands Used

- `squeue` for active queue data
- `sacct` for recent accounting data
- `sinfo` for partition and node-state summaries

Each command is collected independently. If one command is unavailable or times out, the dashboard still renders the remaining data and shows the failure in the command-health panel.

## Requirements

- Node.js 18 or newer
- npm
- Slurm client commands available in `PATH`
- Access to Slurm accounting if you want `sacct` history

## Run

```bash
npm install
npm start
```

Open `http://localhost:3018`.

## Configuration

Environment variables:

- `PORT`: HTTP port, defaults to `3018`
- `HOST`: bind address, defaults to `0.0.0.0`
- `SLURM_COMMAND_TIMEOUT_MS`: timeout per Slurm command, defaults to `12000`
- `SLURM_HISTORY_START`: `sacct -S` start value, defaults to `now-24hours`

Example:

```bash
PORT=8080 SLURM_HISTORY_START=now-7days npm start
```

## API

- `GET /api/health`: dashboard process health
- `GET /api/cluster`: collected Slurm data and per-command status

## Notes

This app intentionally has no external npm runtime dependencies. `npm install` is still useful for standard npm workflows and future lockfile generation, but the dashboard can run directly with Node.

# STS2 Helper

A local dashboard for Slay the Spire 2. It shows live game state, and forecasts what's coming
from the run's seed: card rewards, shops, events, ancients, fights and maps. See
[docs/rng.md](docs/rng.md) for how the forecasts work.

## Run it

- **Double-click `STS2 Helper.cmd`.** It checks for updates, installs dependencies when they've
  changed, starts the server (unless it's already running), waits until it's ready, and opens
  <http://localhost:3000>.
- **Add shortcuts once:** run `launcher\Install shortcuts.cmd`. You get an *STS2 Helper* icon on
  the Desktop and an *STS2 Helper* folder in the Start menu (with *Stop STS2 Helper*).
- **Stop it:** close the minimised *STS2 Helper server* window, or run
  `launcher\Stop STS2 Helper.cmd`.

`start.bat` (and `..\start.bat` at the repo root) still work and do the same thing.

Launcher options (`launcher\launch.ps1`): `-NoUpdate` skips `git pull`, `-NoBrowser` doesn't
open the page, `-Port 3001` uses another port.

## Requirements

- [Node.js](https://nodejs.org/) (LTS).
- Slay the Spire 2 installed. Hover cards and monster pictures are read from
  `SlayTheSpire2.pck` in the default Steam folder; set `STS2_PCK` if yours is elsewhere.
- Optional: the [.NET SDK](https://dotnet.microsoft.com/download), to generate maps for acts you
  haven't reached yet (Map tab, Act 2/3).
- Optional: the `mod/` folder holds a game mod that streams live combat state (see
  `mod/install.ps1`).

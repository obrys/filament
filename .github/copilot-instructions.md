# Copilot Instructions

## Project Overview

This project is an application for filament management. It helps individuals or a small teams to manage their 3D print farms in terms of resources.

The basic idea is that the application manages a fillament storage. 

* There are multiple filament types, like brand (Bambu, Prusa, Creality), material (PET, PLA, ASA, ...), type (basic, matte, glow, silk, ...), color, weight of the spool.
* There are each individual spool of such a filament type (there can be more spools of the same filament type). Each filament spool has weight of the filament. There must be the ability to override filament type's spool weight (for case when a refill kit has been used and the filament is on a different spool).
* Each spool has properties, like remaining filament in grams.
* There must be an easy way for the user to decrease the weight of the spool. Optionally, it can be entered a note (like the model), and URL of the model.
* For each spool, there can be tracked its history, when it was opened, when and what models has been printed, and when it was finally finished.
* The application will be hosted privately in LAN. There isn't any authenication/authorization necessary at this time of the development.
* It is expected to manage 50-150 filament types
* It is expected to manage 50-300 spools
* It is expected to host up to five concurrent users
* There should be a system of identifiers (identifier for fillament types and identifiers for spools)
  * Identifiers should be short
  * Identifier for filament types should hold at least 1000 types
  * Identifier for spools should hold at least 100000 spools
  * It can be a combination of numbers and letters, case insensitive, there shouldn't be used silimar letters, like 0 and O, 1 and I and so on.
* There should be a basic overview on the filament types and spools.
* There should be some usage graphs over time.
* There should be URL of each indifidual spool and each indifidual filament type.
* There should be a way to print a small etiquete of a selected spools (one or more spools), which will generate a PDF of one or more itikettes, which can be printed and glued to each individuals pools. There should be graphically visible their brand, material, type, color, identifier, and QR code which is the unique page of the spool.


## Tech Stack back-end

- **Runtime**: .NET 10
- **Language**: C# (latest available version for .NET 10)
- **Database**: MariaDB
- **Database layer**: EF Core
- **OS**: Linux-based containers (with ability to run on memory constrained device, like 256-512MB RAM)

Try to externalize the business logic if possible. Always use unit tests for business logic. Always use DTOs for API calls, the DTOs should be mapped to domain model objects, for the call the database, always use mapping to entities and then back from entities to domain model. Try to keep this three-layer architecture.

## Tech Stack front-end

- React-based front end
- The design should be minimalistic and usable for mobile, tablet and desktop use.
- It can use technology like WebSockets to get events about changes in the data so the front-end can request the new data. This way instant updates on other devices can be achieved, but it has to be implemented carefully not to produce any memory leaks. It is also important to implement some kind of keep-aplive request/response to server know when client is disconnected, and to client know when server is disconnected to retry connections. 


## Solution Structure

```
src/          # Production projects  (add: <ProjectName>/<ProjectName>.csproj)
tests/        # Test projects        (add: <ProjectName>.Tests/<ProjectName>.Tests.csproj)
```

Document naming conventions for projects when they are added, e.g.:
  - Filament.Core       — domain / business logic
  - Filament.Api        — HTTP API host
  - Filament.Core.Tests — unit tests for Filament.Core



## Expected use cases (not all are listed)

* Create filement type
* Delete filament type (if no spools are present)
* Display filament type, including spools, with already finished spools displayable by a toggle "display also finished".
* Create a spool based on a filament type
* Delete a spool (this should be used in rare case when the spool is created by a mistake)
* Display a spool with detail - weight, weight including spool, projects prinded by this spool, the ability to add another project and lower the filament weight by that.
* Display a dashboard with number of spools, recent changes into the stock, there can be graphs used to display that.

Keep in mind that all display and edit operations must be also usable from a desktop as well as from the cellphone.


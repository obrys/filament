# Sorting feature

Currently, the application provides wro lists of data:

* Filament types
* Spools

Filament types represents the different types of filaments, like Bambulab PLA Basic White, Polyterra PLA Matte Green, and so on.

Spools represents instances of those filament types, with print events and eventually the spool is finished. A new spool of the same type can be created...

The main work in the application is with the spools. Currently, spools are ordered as they re entered to the system, which is not useful.

I need to introduce a new sorting feature of spools. I need to be able to sort spools by:

* Last used (last time used first)
* Least remaining (spools with the least remaining filament first)
* Most remaining (spools with the most remaining filament first)

The default sorting is by last used.

The sorting shouldn't be done in front end. It has to go to backend and the SQL query should be modified to return the spools in the correct order. Front end should only instruct the back endwhat sorting should be performed there.

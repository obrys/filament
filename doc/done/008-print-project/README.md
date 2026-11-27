# Print Project

Print Project feature is the feature to make printing of more complext project easier to enter as the filament consumption.

## What is it about?

In menu, like "typer" or "spools", I would like another menu item, which is "print projects". In this menu I expect the list of print projects. The single print project is contains:

* Title - a title of the project; mandatory field
* Description - a multi-line text; optional field
* URL - an optional field
* One or more filament types; each filament type contains
    * grams - the consumption the print project takes


The list of print projects has a filter, when you can display archived print projects.

The list of print projects is sorted by the last printed print project. If the print project hasn't been printed yet, it is ordered by the creation date. In other words, the sorting is by date taken from the newest print 
or creation date if no print is available. If the project is archived, the `ArchivedAt` timestamp will be used.

Each print project can be:
* archived
* unarchived if is archived
* printed
* undo/redo the print
* changed

## Display detail of the print project

It will display the title, description, URL and "printed project" section.

The printed project list will display the list of prints of this project. For each record it will display date and time of the print and the possibility to undo the print and redo the line if undone.


## Archive the print project

It is a simple operation. The project receive `Archived=true` property and `ArchivedAt` property receives date and time of the archival date. The operation must be confirmed by a dialogue. Archived project cannot be 
printed or updated.


## Unarchive the print project

It is a reverting operation of the archive operation. It sets `Archived=false` and `ArchivedAt` is set to `NULL`.


## Print the print project

Print project is a pattern you can quickly use to enter your print to the database. So if you click the PRINT button, or you activate the print operation, you will see the page to select spool for each of your pre-defined 
spool type. The spool selection will open list of unfinished spools of the type. As the user, they are not constrained with only the spools of the type. They can click "other spools" and it will display the dialogue where 
they can filter the spools by brand, material, type, and color. After the selection the spools one by one, they can also alter the pre-filled consumed grams. After the confirmation, all the selected spools will be 
consumed. They will receive the line in the history section of the spool with the consumed amount. In the history, the record will look slightly different. The "Undo" operation will not be available. The project will be 
click through to the project page with highlighted row in the "project prints".


## Project prints

It is a lost on the print project. Each line contain spools and grams used along with date and time of the print. Selected spools can be clicked through to the detail of the spool with the row related with the print 
highlighted.

If the project print is "undo" the consumption on the spool page will look like other consumption which is undone. On the spool page, there is no undo/redo available, it is on the project page, so the user can undo/redo 
the whole project. The logic is the same as with the consumption of a single spool, but it is applied to all the spools. Once the print of the consumption project is created, it canot be modified. Id can be only 
deactivated by the undo operation.

## Change of the print project

The print project can be changed. It can:

* Add new spool types
* Remove existing spool types
* Update the spool grams
* Change the spool type
* Change the URL, Title, and Description

Changes to spool types, grams will not affect the existing prints from the print porject.
Changes to Title, description, and URL will affect the print project - they will look different on the spool history and the print project detail and the list of the print porject will also be affected.


## Expected technical details

The database table responsible for the spool consumption events, it will receive a nullable field for the id of the print project print, so the event will be linked with the print project print line.

There will be a database table responsible for the print project.

There will be database table linking print project with spool types which will include the consumption in grams.

There will be database table responsible for the prints of the print project. It will contain a link to print project with date and time. The exact consumption will be all spool event records with the print project print id 
record on the database table of the print of the print project.

Undo operation will disable not only the print project print record but also all the spool events. Redo operation will "undisable" also the spool events.



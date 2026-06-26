# Filters for spools and filament types

Filament types and spools contains table data. If there is more than a few dozens of records, there is a problem with the user experience.

There must be implemented filters to get the correct record filtered.

## Filters

The filters for filament types and spools will be in common. Basically the following filters must be present:

* Brand (like Bambu, Prusa)
* Material (like PETG, PLA)
* Type (like Basic, Silk)
* Color

It is important to say, that all types of filters are independent to each others. For example, if I select only Material PETG, I'll have listed all PETG filament types or spools no matter of Brand, Color, or Type. There can a combination like Color and Material, or Type and Color.

The filter selection of Color should display the name of the color and number of items which will be displayed after selecting such an option. The same applies to the other filters. It also applies to the combination, so if I select PETG and Color RED, the Type filter will probably display only "Basic (1)" and "Silk (0)", because PETG doesn't exist in Silk Type.

Items in the filter selection must be sorted by number of the items available after the selection. Items with zero items (0) will be on the bottom (descendant order).

After the filter is active, there must be an option to remove particular filtered option. For example if I select Color RED and Material PETG, I must be able to remove Color.

The filtering should be executed on server and the filtered set should be sent over to the browser. Browser should only display the result, not to perform any client-side filtering.

For the filtration of Color, there may be a situation that there are colors like "red" and "burning red". Even though both are red colors, they are different.

## Gui implementation

The implementation of the filter must take in account the fact that this application is used not only from a desktp web browser, but also from a cell phone. It must be usable on smaller screens too.

Use a common best practise in the design of such UI element.

Filtered option could be reflected in location bar, so navigation throughour history of the browser will be possible. (Back button of the browser will undo the last filtering action.)
# Consumption graph

This change request is about the consumption graph improvement.

The current state shows bars only for the days where was some consumption. This isn't a useful information.

* I need a line graph of consumed filament.
* There will be another line graph showing the total amount of the filament.
* If I add new spool to the system, it increases the total amount of the filament. It will not have any impact to the line of consumed filament.
* If I make an adjustment, it will affect only the total amount of the filament, not the consumed filament.
* If I consume the filament, it will affect both, consumend line and the total line.
* If I finish a spool which isn't completely empty, it will affect both the consumed and the total line.

Ask me, if I missed some other scenario.

* The graph will have days on x-axis.
* The graph will have y-axis dedicated to two values.
    * The total line: 
        * It will have y-axis scale on the left side of the graph. 
        * The scale will start with 0 and ends with the highest value in the last 30 days + 5%.
        * If there isn't anything on stock, use 1kg value as the scale.
    * The consumption line:
        * It will have y-axis scale on the right side of the graph.
        * The scale will start with 0 and ends with the highest consumption in last 30 days + 5%.
        * If there isn't any sonsumption, use 1kg value as the scale.
    * The lines will have a different color.
    * The lines will be labeled in legend.
    * When mouse is on the graph, it will highlight the day (x-axis) values with the exact values in the selected day.


Please cover the functionality with Playwright tests to ensure the result.

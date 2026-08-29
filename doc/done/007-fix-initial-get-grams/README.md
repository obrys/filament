# Fix `InitialGetGrams` of spools

I found a bug. It is a case when I create a spool but I want to define a different value from the filament default wight of the spool. For example, the standard wight of filament spool is defined at `filament` table as 1000 grams, but I create a spool as only 250 grams, because I bought a failament with lower amount of filament on the spool.

Please check if the application correctly populates the `InitialNetGrams` value of the `sppol`.

Please check if the application correctly displays the remaining value.

Please cover that with tests (unit and Playwright tests). If discrepancies found, fix the problem.
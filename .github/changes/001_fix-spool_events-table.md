# Fix the `spool_events` table

The current application uses database table `spools`:

+-------------------------------+---------------+------+-----+---------+-------+
| Field                         | Type          | Null | Key | Default | Extra |
+-------------------------------+---------------+------+-----+---------+-------+
| Id                            | varchar(8)    | NO   | PRI | NULL    |       |
| FilamentTypeId                | varchar(8)    | NO   | MUL | NULL    |       |
| RemainingGrams                | int(11)       | NO   |     | NULL    |       |
| InitialNetGrams               | int(11)       | NO   |     | NULL    |       |
| EmptySpoolWeightGramsOverride | int(11)       | YES  |     | NULL    |       |
| Status                        | int(11)       | NO   | MUL | NULL    |       |
| CreatedAt                     | datetime(6)   | NO   |     | NULL    |       |
| OpenedAt                      | datetime(6)   | YES  |     | NULL    |       |
| FinishedAt                    | datetime(6)   | YES  |     | NULL    |       |
| Notes                         | varchar(1024) | YES  |     | NULL    |       |
+-------------------------------+---------------+------+-----+---------+-------+



and `spool_events`:

+---------------------+---------------+------+-----+---------+----------------+
| Field               | Type          | Null | Key | Default | Extra          |
+---------------------+---------------+------+-----+---------+----------------+
| Id                  | bigint(20)    | NO   | PRI | NULL    | auto_increment |
| SpoolId             | varchar(8)    | NO   | MUL | NULL    |                |
| Kind                | int(11)       | NO   |     | NULL    |                |
| DeltaGrams          | int(11)       | NO   |     | NULL    |                |
| RemainingAfterGrams | int(11)       | NO   |     | NULL    |                |
| ProjectName         | varchar(256)  | YES  |     | NULL    |                |
| ProjectUrl          | varchar(1024) | YES  |     | NULL    |                |
| Notes               | varchar(1024) | YES  |     | NULL    |                |
| OccurredAt          | datetime(6)   | NO   | MUL | NULL    |                |
+---------------------+---------------+------+-----+---------+----------------+

I would like to make it correct, denormalized, and remove redundant values.

* spools.RemaingGrams can be computed from spool_events. Please remove the RemainingGrams from the database table and compute that at application level from records from `spool_events`.
* Table `spool_events` contains RemainingAfterGrams. I think it is not good. The remaining can be counted by the previous DeltaGrams and spools.InitialNetGrams. RemainingAfterGrams makes sense only if it is the adjustment event.
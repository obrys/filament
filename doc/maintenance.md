# Common useful commands to maintain the application

Connect to the database

```bash
ssh -t filament@web.lan "podman exec -it filament-db mariadb -u filament -p'filament'"
```

Assuming that 

* `filament@web.lan` is a ssh login and hostname
* `filament-db` is the container name where the MariaDB is running
* `-u filament` is the login to the database
* `-p'filament'` is the password to the database

_Please note: In my case, the password doesn't matter because it is hosted in an isolated network from the rest of the traffic. Your case might be different so modify that according to your case._ 


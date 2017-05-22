#!/bin/bash
DB=$1
if [ -z "$1" ]
 then
  DB="discord.db"
fi
echo $DB
sqlite3 -line $DB "SELECT * FROM schema LIMIT 1;"

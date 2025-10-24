name: My First Shell Script
on:
  push:
    branches:
      - main
jobs:
  run_script_job:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Run my shell script
        run: sh ./myscript.sh

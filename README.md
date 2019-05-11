# x4codecomplete README
To install, go to releases & download the .vsix file. Then install it like any other program.
I highly recommend using this in conjunction with (these instructions)[https://forum.egosoft.com/viewtopic.php?f=181&t=416621] by ledhead900, but it's not technically a requirement.
## Features

XML code complete for Visual Studio Code. Currently completes entries from scriptproperties.xml.

## Requirements

None yet

## Extension Settings

Exceedingly Verbose: enables debug logging. Defaults to false

Minimum Number of Characters: how many characters should it wait before before trying to match

Script Properties Location: Absolute path to scriptproperties.xml, including scriptproperties.xml in the path. REQUIRED, no default.

## Known Issues

None yet

## Release Notes

### 1.0.0

Initial release. Supports scriptproperties.xml autocomplete

### 1.0.1
Minor improvements; now has configuration & generates the entries at startup from scriptproperties.xml, removing the need for rerunning a python script when scriptproperties.xml updates.
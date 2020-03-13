#!/usr/bin/env node
var fs = require('fs');
var path = process.argv[2];
var data = "#!/usr/bin/env node\n\n";
data += fs.readFileSync(path);
fs.writeFileSync(path, data);
var fs = require('fs');
var sql = fs.readFileSync('_qa_full_deploy.sql', 'utf8');
var lines = sql.split('\n');

// Find good split points: lines ending with ; followed by blank line or comment
var splitPoints = [];
for (var i = 0; i < lines.length; i++) {
  var trimmed = lines[i].trim();
  if (trimmed.endsWith(';') && (i + 1 >= lines.length || lines[i + 1].trim() === '' || lines[i + 1].trim().startsWith('--'))) {
    splitPoints.push(i + 1);
  }
}

var total = lines.length;
var target1 = Math.floor(total / 3);
var target2 = Math.floor(total * 2 / 3);

// Find closest split points to targets
function findNearest(target) {
  var best = splitPoints[0];
  for (var j = 0; j < splitPoints.length; j++) {
    if (Math.abs(splitPoints[j] - target) < Math.abs(best - target)) {
      best = splitPoints[j];
    }
  }
  return best;
}

var sp1 = findNearest(target1);
var sp2 = findNearest(target2);

// Ensure sp2 > sp1
if (sp2 <= sp1) sp2 = findNearest(target2 + 500);

fs.writeFileSync('_qa_deploy_part1.sql', lines.slice(0, sp1).join('\n'));
fs.writeFileSync('_qa_deploy_part2.sql', lines.slice(sp1, sp2).join('\n'));
fs.writeFileSync('_qa_deploy_part3.sql', lines.slice(sp2).join('\n'));

console.log('Split at lines:', sp1, sp2, 'of', total);
console.log('Part1:', Math.round(fs.statSync('_qa_deploy_part1.sql').size/1024) + 'KB');
console.log('Part2:', Math.round(fs.statSync('_qa_deploy_part2.sql').size/1024) + 'KB');
console.log('Part3:', Math.round(fs.statSync('_qa_deploy_part3.sql').size/1024) + 'KB');

// Verify last line of each part ends with ; or is a comment
var p1last = lines[sp1 - 1].trim();
var p2last = lines[sp2 - 1].trim();
console.log('Part1 ends with:', p1last.substring(0, 60));
console.log('Part2 ends with:', p2last.substring(0, 60));

#!/usr/bin/env node

var elasticsearch = require('elasticsearch');
var markupjs = require('markup-js');
var fs = require('fs');
var colour = require('colour');
var moment = require('moment');
var output=[];
var allfields;
var regex = false;
var regexflags = 'gm';
var rawoutput;
var searchDone = true;
var hostportlist = 'localhost:9200';
var refreshInterval = 1000;
var searchFilename=__dirname + '/default.search';
var searchTemplate = '';
var loglevel = 'error';
var context = {
  index:'_all',
  from:'now-10m',
  fetchsize: 300
};

console.info = function (){};

console.info('Processing Commandline arguments');
process.argv.forEach(function (val, ind, array) {
  if(/^(-h|--help|-\?)$/.test(val)) {
    console.log(process.argv[0]+':');
    console.log('\t[--hostport = ' + hostportlist + ']');
    console.log('\t[--search=<filename> default: ' + searchFilename);
    console.log('\t[--regex=\'([\d\.]+)\' default: none');
    console.log('\t[--regexflags=\'gm\'   default: ' + regexflags);
    console.log('\t[--allfields         default: false ');
    console.log('\t[--raw         	    default: false ');
    console.log('\t[--fetchsize=\'20\'  default: 100 ');
    console.log('\t[-i|--refreshInterval=\'1000\'  default: ' +
      refreshInterval);
    console.log('\t\t\tHow often a new search is issued');
    console.log('\t[--context=\'{\'custom\':\'json\'}\'  default:' +
      JSON.stringify(context) );
    console.log(['\t\t\tContext is what varables pass to the search template',
      'for json markup'].join(' '));
    console.log(['\t\t\tcontext=<key>=<val> is a way to set any varable',
      'inside the context array. Make sure this is used after --contextfile',
      'or --context=<customejson>'].join(' '));
    console.log('\t[--index=<index>|--context = index=<index>     default: ' +
      context.index);
    console.log('\t[--from=<datestamp>|--context = from=\'now-5m\'  default: ' +
      context.from);
    console.log(['\t\t\tfrom can be of any valid Elasticsearch timevalue',
      'or Caclulation'].join(' '));
    process.exit(1);
  }

  if(val === '--allfields' ){
    allfields = true;
    console.info('--allfields = ' + allfields);
  }
  if(val === '--raw'){
    rawoutput = true;
    console.info('--raw = ' + rawoutput);
  }
  if(val.indexOf(' = ') >0) {
    var s = val.split(/=/);
    console.info(s[0] + ' : ' + s[1]);
    if(s[0] === '--hostport') {
      hostportlist = s[1];
    }
    if(s[0] === '--regexflags') {
      regexflags =  s[1];
    }
   if(s[0] === '--regex') {
      regex = s[1];
   }
   if(s[0] === '--loglevel') {
      loglevel = s[1];
   }
   if(s[0] === '--refreshinterval' || s[0] === '-i') {
      refreshInterval = s[1];
   }
   if(s[0] === '--contextfile') {
      context = s[1];
      if(fs.existsSync(s[1])) {
        var searchTemplate = fs.readFileSync(s[1],'utf8');
        console.info(searchTemplate);
      } else {
        console.error('file does not exist:' + s[1]);
        process.exit(2);
      }
      context = JSON.parse(context);
    }
    if(s[0] === '--context' && s.length == 2){
      context = s[1];
      context = JSON.parse(context);
    }
    if(s[0] === '--context' && s.length > 2 ){
      console.log(s);
      context[s[1]] = s[2];
      console.info('context.' + s[1]+' = ' + s[2]);
    }
    if(s[0] === '--search'){
      searchFilename = s[1];
    }
    if(s[0] === '--index'){
      context.index = s[1];
    }
  }
});

regex = new RegExp(regex, regexflags);
if(fs.existsSync(searchFilename)) {
	var searchTemplate = fs.readFileSync(searchFilename,'utf8');
} else {
	console.error('file does not exist:' + searchFilename);
	process.exit(2);
}

var client = new elasticsearch.Client({
  host: hostportlist,
  protocol: 'http',
  index: context.index,
  keepAlive: true ,
  ignore: [404],
  log: loglevel,
  suggestCompression: true,
  sniffOnStart: true,
  sniffInterval: 60000
});

client.ping({requestTimeout: 1000}, function(error) {
  if(error) {
    console.error('elasticsearch cluster may be down!');
    process.exit(1);
  } else {
    console.log('Connected to Elasticsearch cluster.');
  }
});

function printOutput() {
	console.info('INFO'.yellow + ' inPrintOutput length to print = ' +
    output.length);
	while(output.length > 0) {
    hit = output.shift();
    console.info('====' + hit + ' of ' + output.length);
		if(allfields) {
			console.log(hit._source['@timestamp'].red + ':\n'.green +
        JSON.stringify(hit._source));
		} else {
			if(rawoutput) {
				console.log(JSON.stringify(hit,null,2));
			} else {
				console.log(hit._source['@timestamp'].red + ': '.green +
          hit._source.message);
			}
		}
		if(regex) {
			var result = hit._source.message.match(regex);
			if(result) {
				console.log('\tregex: '.red + JSON.stringify(result).yellow);
			}
		}
		context.from = hit._source['@timestamp'];
  }
}

function doSearch() {
	console.info('Running search'.blue);
  if(!searchDone) {
    console.log('Search Not Complete');
    return;
  }
	var search = markupjs.up(searchTemplate,context);
	client.search(JSON.parse(search), ph = function printHits(error, response) {
    if(error) {
      return console.error('ERR:'.red + error);
    }
      console.info('INFO'.yellow + 'Count = ' + response.hits.hits.length);
      response.hits.hits.forEach(function (hit) {
        output.push(hit);
      });
      printOutput();
      if(output.length >= response.hits.total) {
        searchDone = true;
        console.info('Search complete'.blue);
        return;
      }
      client.scroll({
        scrollId: response._scroll_id,
        scroll: '30s'
      }, ph);
    }
  );
}

setInterval(function() {
  if(searchDone) {
    doSearch();
  }
}, refreshInterval);


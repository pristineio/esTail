#!/usr/bin/env node
'use strict';
var elasticsearch = require('elasticsearch');
var align = require('string-align');
var markupjs = require('markup-js');
var fs = require('fs');
var colour = require('colour');
var moment = require('moment');
var allfields;
var regex;
var regexflags = 'gm';
var searchDone = true;
var hostportlist = 'efk.internal:9200';
var refreshInterval = 1000;
var searchFilename=__dirname + '/default.search';
var searchTemplate = '';
var loglevel = 'error';

function RingBuffer() {
  this.buffer = {};
  this.maxLength = 50;
}

RingBuffer.prototype.push = function(x) {
  if(Object.keys(this.buffer).length >= this.maxLength) {
    delete this.buffer[Object.keys(this.buffer)[0]];
  }
  if(!(x in this.buffer)) {
    this.buffer[x] = true;
  }
};

RingBuffer.prototype.print = function() {
  Object.keys(this.buffer).forEach(function(x) {
    console.log(x);
  });
  this.buffer = {};
};

var outputBuffer = new RingBuffer();


var context = {
  index: '_all',
  from: new Date(new Date() - 3*refreshInterval).toISOString(), //'now-1m',
  fetchsize: 50
};

process.argv.forEach(function(val, ind, array) {
  if(/^(-h|--help|-\?)$/.test(val)) {
    console.log(process.argv[0]+':');
    console.log('\t[--hostport = ' + hostportlist + ']');
    console.log('\t[--search=<filename> default: ' + searchFilename);
    console.log('\t[--allfields         default: false ');
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

  if(val === '--allfields' ) {
    allfields = true;
  }
  if(val.indexOf('=') > 0) {
    var s = val.split(/=/);
    if(s[0] === '--hostport') {
      hostportlist = s[1];
    }
    if(s[0] === '--refreshinterval' || s[0] === '-i') {
      refreshInterval = s[1];
    }
    if(s[0] === '--contextfile') {
      context = s[1];
      if(fs.existsSync(s[1])) {
        var searchTemplate = fs.readFileSync(s[1],'utf8');
      } else {
        console.error('file does not exist:' + s[1]);
        process.exit(2);
      }
      context = JSON.parse(context);
    }
    if(s[0] === '--context' && s.length == 2) {
      context = s[1];
      context = JSON.parse(context);
    }
    if(s[0] === '--context' && s.length > 2 ) {
      context[s[1]] = s[2];
    }
    if(s[0] === '--search') {
      searchFilename = s[1];
    }
    if(s[0] === '--index') {
      context.index = s[1];
    }
  }
});

regex = new RegExp(regex, regexflags);
if(fs.existsSync(searchFilename)) {
	var searchTemplate = fs.readFileSync(searchFilename, 'utf8');
} else {
	console.error('file does not exist:' + searchFilename);
	process.exit(2);
}

var client = new elasticsearch.Client({
  host: hostportlist,
  protocol: 'http',
  index: context.index,
  keepAlive: true,
  ignore: [404],
  log: loglevel,
  suggestCompression: true,
  sniffOnStart: true,
  sniffInterval: 60000
});

client.ping({requestTimeout: 5000}, function(error) {
  if(error) {
    console.error('E '.red + error.message);
    process.exit(1);
  }
});

function printOutput(output) {
	while(output.length > 0) {
    var hit = output.shift();
    var prefix = '';
    var str = hit._source['timestamp'].replace('T', ' ')
      .replace(/\+.*/, '').gray + '  ';
    hit._source.host = align(hit._source.host, 16, 'center');
    switch(hit._source.message.charAt(0)) {
      case 'I':
        prefix = 'I'.green;
        str += hit._source.host.green + '  ';
        break;
      case 'W':
        prefix = 'W'.yellow;
        str += hit._source.host.yellow + '  ';
        break;
      case 'E':
        prefix = 'E'.red;
        str += hit._source.host.red + '  ';
        break;
    }
		context.from = hit._source['timestamp'];
    str = prefix + '  ' + str +
      hit._source.message.substring(1, hit._source.message.length);
    outputBuffer.push(str);
  }
  outputBuffer.print();
}

function doSearch() {
  if(!searchDone) {
    return console.log('Search Not Complete');
  }
	var search = markupjs.up(searchTemplate, context);
  var ph;
	client.search(JSON.parse(search), ph = function(error, response) {
    if(error) {
      // return console.error('E '.red + error.message);
    }
    if(response.hits && response.hits.hits) {
      printOutput(response.hits.hits);
      if(response.hits.hits.length >= response.hits.total) {
        searchDone = true;
        return;
      }
      client.scroll({
        scrollId: response._scroll_id,
        scroll: '30s'
      }, ph);
    }
  });
}

setInterval(function() {
  if(searchDone) {
    doSearch();
  }
}, refreshInterval);

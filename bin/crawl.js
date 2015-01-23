var JournalTOCs = require('journalTOCs');
var fs = require('fs');
var request = require('request-json');
var EventEmitter = require('eventemitter3').EventEmitter;
var moment = require('moment');
var _ = require('lodash');

var issn = "1932-6203";

var jt = new JournalTOCs('richardsmith404@gmail.com');
var api_key = 'REDACTED';

var client = request.newClient('http://contentmine.org/api/', {
  headers: {
    'api_key': api_key
  },
  followAllRedirects: true
});

// run a full update
// updateNew(issn);

// test the ContentMine API query
var ret = getCMLatest(issn);
ret.once('result', function(x) {
  console.log(x.map(function(y) {
    return y._source.date.published;
  }));
})

// sort an array of bibJSON objects by ascending published date
function dateSort(arr) {
  return arr.sort(function(a, b) {
    return moment(b.date.published).unix() - moment(a.date.published).unix();
  })
}

// given a journal ISSN, check whether there are any newly published articles
// not yet added to contentmine, grab them, and add them to contentmine.
//
// 'newly published' is defined as having a published date newer
// than the most recent entry for this journal in contentmine
function updateNew(issn) {
  var cmret, jtret;
  var cmlatest = getCMLatest(issn);
  var jtlatest = getJTOCsLatest(issn);

  cmlatest.once('result', function(ret) {
    cmret = ret.map(function(y) { return y._source; });
    if (cmret && jtret) {
      takeNewAndSubmit(cmret, jtret);
    }
  });

  jtlatest.once('result', function(ret) {
    jtret = ret;
    if (cmret && jtret) {
      takeNewAndSubmit(cmret, jtret);
    }
  });
};

// given the latest entries in CM and JTOCs, find the new entries and submit
// them to the ContentMine catalogue. Print a summary of the submission.
function takeNewAndSubmit(cmlatest, jtlatest) {
  var newest = takeNewFromJTOCs(cmlatest, jtlatest);
  var responses = [];
  var done = _.after(newest.length, function() {
    console.log("successfully submitted " + newest.length + " new entries");
    console.log(responses.map(function(x) {
      return({ title: x.title, id: x.id });
    }));
  });

  newest.forEach(function(entry) {
    console.log(JSON.stringify(entry, undefined, 2));
    catalogueSubmit(entry, function(error, response, body) {
      // console.log(response);
      console.log(response.statusCode);
      if (error) {
        // console.log(error);
      } else {
        responses.push(body);
        done();
      }
    })
  });
};

// given a journal ISSN, get the latest entries for that ISSN in the contentmine
// catalogue
function getCMLatest(issn) {
  var x = {
    query: {
      filtered: {
        filter: {
          term: {
            'journal.issn.exact': issn
          }
        }
      }
    },
    sort: [
      { 'date.published': { order: "asc" } }
    ],
    size: 50
  };
  return catalogueQuery(x);
}

// given a journal ISSN, get the latest entries for that ISSN in the JournalTOCs
// catalogue
function getJTOCsLatest(issn) {
  var ee = new EventEmitter();
  var articles = jt.journalArticles(issn);
  articles.on('result', function(article) {
    var result = article.map(function(x) {
      x.issn = issn;
      return bibJSONify(x);
    });
    ee.emit('result', result);
  });
  return ee;
}

// given the latest entries from the Contentmine storage API, and the latest
// from the JournalTOCs API, return the set of new entries. Both sets of entries
// should be in bibJSON format.
function takeNewFromJTOCs(cmlatest, jtocslatest) {
  if (cmlatest.length == 0) {
    return dateSort(jtocslatest);
  }
  cmlatest = dateSort(cmlatest);
  var cmdate = moment(cmlatest[0].date.published).unix();
  var newest = jtocslatest.filter(function(x) {
    return moment(x.date.published).unix() > cmdate;
  });

  return newest;
}

// take the response from JournalTOCs
// and convert it to ContentMine bibJSON
function bibJSONify(json) {
  var bj = {};
  ['title', 'description', 'summary'].forEach(function(key) {
    bj[key] = json[key];
  });
  bj.publisher = {
    name: json['dc:publisher']['#']
  };
  bj.journal = {
    name: json['prism:publicationname']['#'],
    issn: json.issn
  };
  bj.link = [
    {
      type: "journaltocs",
      url: json.link
    }
  ];
  var pubdate = moment(json['prism:publicationdate']['#']);
  bj.date = {
    published: pubdate.utc().format()
  };
  bj.identifier = [];
  if (json.hasOwnProperty('dc:identifier') &&
      /^DOI/.test(json['dc:identifier']['#'])) {
    var re = /^DOI (.*)/;
    var result = re.exec(json['dc:identifier']['#']);
    bj.identifier.push({
      type: 'doi',
      id: result[1]
    });
  }
  bj.author = [json.author]
  return bj;
};

// make a query to the ContentMine catalogue API
function catalogueQuery(x) {
  var ee = new EventEmitter();
  client.post('catalogue/query', x, function(error, response, body) {
    if (error) {
      ee.emit('error', error);
      console.log(response.statusCode);
    }
    ee.emit('result', body.hits.hits);
  });
  return ee;
};

// submit a single entry to the ContentMine catalogue API
function catalogueSubmit(data, cb) {
  // console.log(data);
  data.api_key = api_key;
  client.post('catalogue', data, cb);
};

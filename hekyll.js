var fs = require("fs");
var rmrf = require("rimraf");
var yaml = require("js-yaml");
var marked = require("marked");
var Mold = require("hekyll-mold");
var util = require("./util");
var execFile = require('child_process').execFile;
var path = require("path");
var compressor = require("node-minify");
var sass = require("node-sass");
var s = require("string");
var async = require("async");
var mu = require("mu2");
CodeMirror = require("codemirror/addon/runmode/runmode.node.js");

marked.setOptions({highlight: highlightCode, gfm: true});

function highlightCode(code, lang) {
  if (!lang) return code;
  if (!CodeMirror.modes.hasOwnProperty(lang)) {
    try { require("codemirror/mode/" + lang + "/" + lang); }
    catch(e) { console.log(e.toString());CodeMirror.modes[lang] = false; }
  }
  if (CodeMirror.modes[lang]) {
    var html = "";
    CodeMirror.runMode(code, lang, function(token, style) {
      if (style) html += "<span class=\"cm-" + style + "\">" + Mold.escapeHTML(token) + "</span>";
      else html += Mold.escapeHTML(token);
    });
    return html;
  } else return code;
}

function hasFrontMatter(file) {
  var fd = fs.openSync(file, "r");
  var b = new Buffer(4);
  var ret = fs.readSync(fd, b, 0, 4, 0) == 4 && b.toString() == "---\n";
  fs.closeSync(fd);
  return ret;
}

function readFrontMatter(file) {
  if (/^---\n/.test(file)) {
    var end = file.search(/\n---\n/);
    if (end != -1) return {front: yaml.load(file.slice(4, end + 1)) || {}, main: file.slice(end + 5)};
  }
  return {front: {}, main: file};
}

var defaults = {
  postLink: "${name}.html",
  siteDir: "_site/",
  parse: [ "css/", "js/", "." ],
  include: [ "img/", "favicon.ico" ],
  includetype: "copy",
  exclude: [ ]
};
var config;

var muhash = [  ];    //Mustache hash containing all keys and values
var mudepends = [  ]; //Mustache dependency tree - contains filenames along with list of other filenames it depends on
var mucompile = [  ]; //Mustache final compilation order

function readConfig(filename) {
  var config = (util.exists(filename) && yaml.load(fs.readFileSync(filename, "utf8"))) || {};
  for (var opt in defaults) if (defaults.hasOwnProperty(opt) && !config.hasOwnProperty(opt))
    config[opt] = defaults[opt];

  //add each variable (site.NAME) to Mu hash
  config.forEach(function(value, item) {
    var str = "site." + item.toString();
    var array = [ str, value ];
    muhash.push(array);
  });
  return config;
}

function subcheckExcluded(cb, file) {
  config.exclude.forEach(function(exp)
  {
    if (file.match(exp)) { console.log("IGN  : Ignored " + file); cb = false; }
  });
  return cb;
}

function checkExcluded(file)
{
  var included = true;
  var sresult = subcheckExcluded(included, file);
  return !sresult;
}

function parseFile(file)
{
  var ext = path.extname(file);
  switch(ext)
  {
    case ".md":
      //TODO get markdown content into stream using marked -- continue with .html case

    case ".html":
      //TODO start by generating the dependency list -- if the front matter contains "usetemplate: NAME" then add it to dependencies
      //TODO also add anything with {{ template.NAME }} (include {{ and {{&, etc.) into the dependencies list

      //TODO actions for SECOND GENERATION PASS in generate()
      //TODO GENERATE COMPILE ORDER FROM DEPENDENCY LIST
      //TODO minimize html if minimize option selected
      //TODO copy each file in entirety into muhash IF front matter contains "template: NAME" then place into page.NAME -- there's definitely a better way to do this, I've left it alone for now
      //TODO run Mu on the file, replacing current hashes
      //TODO clean all variables -- for now, when a change is made everything has to be recompiled

      break;

    case ".css":
      //CSS Compression
      new compressor.minify({
        type: 'sqwish',
        fileIn: file,
        fileOut: config.siteDir + file,
        callback: function(err, min){
            if (err) { console.error("CSS  :" + err); }
            else { console.log("CSS  : Compressed " + file); }
        }
      });
      break;

    case ".sass":
    case ".scss":
      //SASS file parsing
      //search for main file by looknig for front matter (---)
      if (hasFrontMatter(file))
      {
        //remove the front matter if found to prevent error then read SASS
        fs.readFile(file, "utf8", function(error, data) {
          var dat = data.substringFromLast("---\r\n");
          if (!dat) { dat = data.substringFromLast("---\n");}
          sass.renderFile({
            data: dat,
            outFile: (config.siteDir + file).replace(".scss", ".css").replace(".sass", ".css"),
            success: function(css) {
                console.log("SASS : Parsed " + file);
            },
            error: function(error) {
                console.error("SASS : " + error);
            },
            includePaths: config.parse,
            //imagePath: vars.imagePath,
            outputStyle: 'compressed'
          });
        });
      }
      break;

    case ".js":
      new compressor.minify({
        type: 'uglifyjs',
        fileIn: file,
        fileOut: config.siteDir + file,
        callback: function(err, min){
            if (err) { console.error("JS   :" + err); }
            else { console.log("JS   : Compressed " + file); }
        }
      });
      break;

    default:
      return;
  } //switch
}

function parse() {
  //Prepare
  var base = "";
  var configdir = "./_config.yml";
  if (arguments.length >= 1) { base = arguments[0]; configdir = base + "_config.yml"; }
  config = readConfig(configdir);

  //Clean dirs
  rmrf.sync(config.siteDir, function(error){ if(error) { throw(error); }});
  fs.mkdirSync(config.siteDir, function(error){ if(error) { throw(error); }});
  config.parse.forEach(function(dir) {
    if ((dir.contains("/") || dir.contains("\\")) && (!dir.contains(".")))
    {
      try {
      fs.mkdirSync(config.siteDir + dir, function(error){ if(error) { throw(error); }});
      } catch (e) {
        if (e.code === 'EEXIST') {
          console.warn("CFG  : Config 'parse' key contains duplicate " + dir);
        } else {
          throw e;
        }
      }
    }
  });
  config.include.forEach(function(dir) {
    if ((dir.contains("/") || dir.contains("\\")) && (!dir.contains(".")))
    {
      try {
      fs.mkdirSync(config.siteDir + dir, function(error){ if(error) { throw(error); }});
      } catch (e) {
        if (e.code === 'EEXIST') {
          console.warn("CFG  : Config 'include' key contains duplicate " + dir);
        } else {
          throw e;
        }
      }
    }
  });

  //Parse dirs, performing actions on parsed files
  execFile('find', config.parse, function(err, stdout, stderr) {
    if(err) console.warn("CFG  : " + err);
    var files = stdout.split('\n');
    files.forEach(function(file){
      //check if it's part of excluded types
      if (!checkExcluded(file))
      {
        parseFile(file);
      } //checkExcluded
    }); //files.forEach
  }); //execFile
}

function include() {
  execFile('find', config.include, function(err, stdout, stderr) {
    if(err) console.warn("CFG  : " + err);
    var files = stdout.split('\n');
    files.forEach(function(file){

      fs.stat(file, function(err, stat) {
        if(err != null) {
          if(err.code == 'ENOENT') {
            console.log("INC  : \'" + file + "\' does not exist");
          } else { throw err; }
        }
        else {
          var isdir = stat.isDirectory();
          switch(config.includetype)
          {
            case "copy":
              if (isdir) {
                try {
                  fs.mkdirSync(config.siteDir + file, function(error){ if(error) { throw(error); }});
                } catch (e)
                {
                  if (e.code === "EEXIST") { break; }
                  throw e;
                }
              }
              else {
                util.copyFileSync(file, config.siteDir + file, function(error){ if(error) { throw(error); }});
                console.log("INC  : Copied " + file);
              }
              break;

            case "link":
              if (isdir) {
                fs.mkdirSync(config.siteDir + file, function(error){ if(error) { throw(error); }});
              }
              else {
                // TODO link
              }
              break;

            case "serve":
              // TODO do we want this?
              break;

            default:
              log.warn("CFG  : Config includetype must be one of the following: copy, link, or serve");
              break;
          } //switch
        } //file exists
      }); //stat
    }); //forEach
  }); //execFile
}

function readPosts() {
  var posts = [];
  fs.readdirSync("_posts/").forEach(function(file) {
    var d = file.match(/^(\d{4})-(\d\d?)-(\d\d?)-(.+)\.(md|link)$/);
    if (!d) return;
    var split = readFrontMatter(fs.readFileSync("_posts/" + file, "utf8"));
    var post = split.front;
    post.date = new Date(d[1], d[2] - 1, d[3]);
    post.name = d[4];
    if (!post.tags) post.tags = [];
    if (!post.tags.forEach && post.tags.split) post.tags = post.tags.split(/\s+/);
    if (d[5] == "md") {
      post.content = marked(split.main);
      post.url = getURL(post);
    } else if (d[5] == "link") {
      var escd = Mold.escapeHTML(post.url);
      post.content = "<p>Read this post at <a href=\"" + escd + "\">" + escd + "</a>.</p>";
      post.isLink = true;
    }
    posts.push(post);
  });
  posts.sort(function(a, b){return b.date - a.date;});
  return posts;
}

function gatherTags(posts) {
  var tags = {};
  posts.forEach(function(post) {
    if (post.tags) post.tags.forEach(function(tag) {
      (tags.hasOwnProperty(tag) ? tags[tag] : (tags[tag] = [])).push(post);
    });
    else post.tags = [];
  });
  return tags;
}

function getURL(post) {
  var link = config.postLink;
  for (var prop in post) link = link.replace("${" + prop + "}", post[prop]);
  return link;
}

function ensureDirectories(path) {
  var parts = path.split("/"), cur = "";
  for (var i = 0; i < parts.length - 1; ++i) {
    cur += parts[i] + "/";
    if (!util.exists(cur, true)) fs.mkdirSync(cur);
  }
}

function prepareIncludes(ctx) {
  if (!util.exists(config.includesDir, true)) return;
  fs.readdirSync("_includes/").forEach(function(file) {
    Mold.define(file.match(/^(.*?)\.[^\.]+$/)[1],
                Mold.bake(fs.readFileSync(config.includesDir + file, "utf8"), ctx));
  });
}

var layouts = {};
function getLayout(name, ctx) {
  if (name.indexOf(".") == -1) name = name + ".html";
  if (layouts.hasOwnProperty(name)) return layouts[name];
  var tmpl = Mold.bake(fs.readFileSync(config.layoutsDir + name, "utf8"), ctx);
  tmpl.filename = name;
  layouts[name] = tmpl;
  return tmpl;
}

function generate() {
  var base = "";
  var configdir = "./_config.yml";
  if (arguments.length >= 1) { base = arguments[0]; configdir = base + "_config.yml"; }
  config = readConfig(configdir);  
  var posts = readPosts();
  var ctx = {site: {posts: posts, tags: gatherTags(posts), config: config},
             dateFormat: require("dateformat")};
  prepareIncludes(ctx);
  if (util.exists(config.siteDir, true)) rmrf.sync(config.siteDir);
  posts.forEach(function(post) {
    if (post.isLink) return;
    var path = config.siteDir + post.url;
    ensureDirectories(path);
    fs.writeFileSync(path, getLayout(post.layout || "post.html", ctx)(post), "utf8");
  });
  
  function walkDir(dir) {
    fs.readdirSync(dir).forEach(function(fname) {
      if (/^[_\.]/.test(fname)) return;
      var file = dir + fname;
      if (fs.statSync(file).isDirectory()) {
        walkDir(file + "/");
      } else {
        var out = config.siteDir + file;
        ensureDirectories(out);
        if (/\.md$/.test(fname) && hasFrontMatter(file)) {
          var split = readFrontMatter(fs.readFileSync(file, "utf8"));
          var doc = split.front;
          var layout = getLayout(doc.layout || "default.html", ctx);
          doc.content = marked(split.main);
          doc.name = fname.match(/^(.*?)\.[^\.]+$/)[1];
          doc.url = file;
          out = out.replace(/\.md$/, layout.filename.match(/(\.\w+|)$/)[1]);
          fs.writeFileSync(out, layout(doc), "utf8");
        } else {
          util.copyFileSync(file, out);
        }
      }
    });
  }
  walkDir("./");
}

exports.parse = parse;
exports.generate = generate;
exports.include = include;

/*************************************************************************************
*
* Copyright (c) 2012, Svetlozar Argirov <zarrro [AT] gmail.com>
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in
* all copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
* THE SOFTWARE.
*
*************************************************************************************/

// dLog -  used for debug logging
var dLog = function(){}
var dependenciesDebug = false;

// loadNpm() - load npm module.
// 		Workaround the fact that for some unknow reason, by defaultnpm is installed in
//  	directory which is not on require.paths
function loadNpm() {
	var npm;
	try {
		npm = require('npm');
	} catch(e) {
	}
	if(!npm) {
		var path = require("path");

		for(var i in require.paths) {
			var p = require.paths[i];
			if(path.basename(p) == "node") {
				p = path.join(p, "..", "node_modules", "npm");
				try {
					npm = require(p);
					if(npm) {
						break;
					}
				} catch (e) {
				}
			}
		}
	}
	if(!npm){
		throw new Error("Cannot find module 'npm' !");
	}
	return npm;
}

var DATA_TEMPLATE = {
	  'user_id' : null,
	  'app_name' : null,
	  'app_uuid' : null,
	  'app_type' : 'nodejs',
	  'app_url'  : null,
	  'app_vendor' : null,
	  'pkg_type' : null,
	  'installed' : [],
};

var MONUPCO_HOST = "monupco-otb.rhcloud.com";
var MONUPCO_REGISTER_PATH = "/application/register/";

function configure(options) {
	if(options.url) {
		var url = require('url').parse(options.url);
		MONUPCO_HOST = url.hostname;
		MONUPCO_REGISTER_PATH = url.pathname;
	}
	for(var k in DATA_TEMPLATE){
		if(options[k]) {
			DATA_TEMPLATE[k] = options[k];
		}
	}
	return module.exports;
}

module.exports.configure = configure;

// recurseDependencies(data, out) -  recurse the dependency tree and return a flat
//		list with package dependencies
// 	data -  dependency tree as provided by npm
//  out -  initial output data
function recurseDependencies(data, out) {
	var dep = data.dependencies;
	out = out || {};
	for (var k in dep) {
		if(dependenciesDebug) {
			dLog(">dep>["+k+"]=", dep[k]);
		}
		// Ignore all kind of not resolved dependencies
		if (typeof dep[k] === "string") {
			continue;
		}
		out[dep[k]._id] ={
			n: dep[k].name,
			v: dep[k].version,
		};
		recurseDependencies(dep[k], out);
	}
	return out;
}

// listDependencies(cb) - lists dependencies described in the current directory
// 		cb - callback called wiht single parameter, the dependency list
function listDependencies(cb) {
	var npm = loadNpm()
		, conf = { command: "ls" };
	npm.load(conf, function(er) {
		if (er) {
			throw new Error("Couldn't load 'npm'. Error: " + er);
		};
		npm.commands["ls"]([], true, function(er, data) {
			if (er) {
				throw new Error("'npm ls' failed. Error: " + er)
				return;
			};
			var depData = recurseDependencies(data);
			if(cb) {
				cb(depData);
			}
		});	
	});
}

// httpPost(options, json_data, cb) - POST json data
// 		options - http.request() options
//		json_data - object to be converted to JSON and send as json_data parameter
//		cb - callback , if present called on error or success 
function httpPost(options, json_data, cb) {
	var https = require('https');
	dLog("REQ TO: " + JSON.stringify(options));
	var req = https.request(options);
	req.on('response', function(res){
		var resData = '';
		res.on('data', function (chunk) {
			dLog("RES_DATA: " + chunk);
			resData += chunk;
		});
		res.on('end', function (chunk) {
			dLog("RESPONSE[" + res.statusCode+"] "+ resData);
			if( res.statusCode != 200 || (res.headers['content-type'].indexOf("application/json")!=0)) {
				var errMsg  = "Error "+ res.statusCode + " while posting data to " + options.host +"\n";
						errMsg += resData;
				if(cb) {
					cb(null,errMsg);
				} else {
					throw new Error(errMsg);
				}
				return;
			}
			var response = JSON.parse(resData);
			if(cb) {
				cb(response,null);			
			}
		});
	});
	req.on('upgrade', function(res, socket, upgradeHead){
		console.log("POSTING got upgrade ... WTF? :", upgradeHead);
	});
	req.on('error', function (e) {
	    dLog("Error while posting data:" + e);
		throw new Error("Error while posting data:" + e);
	});

	dLog("POSTING: " + JSON.stringify(json_data));
	req.write(encodeURI('json_data=' + JSON.stringify(json_data)));
	req.end();
	dLog("POSTING DONE: Waiting for response.");
}

function getDepsAsJSON(depData){
	var postData = DATA_TEMPLATE;
	var deps = [];
	for(var i in depData){
		dLog("DEP: [" + i + "]=" + JSON.stringify(depData[i]));
		deps.push(depData[i]);
	}
	postData['installed'] = deps;
	return postData;
}

// postToMonupco(cb) - send package info to monupco
//		cb - callback , if present called on error or success 
function postToMonupco(cb){
	listDependencies(function(depData){
		var postData = getDepsAsJSON(depData);
		var thisModule, vendorModule;
		for(var k in depData){
			if(k.indexOf('common-nodejs-monupco')==0){
				thisModule = depData[k]['n'] + '/' + depData[k]['v'];
			}
			if(/monupco-(.*?)-nodejs/.test(k)){
				vendorModule = depData[k]['n'] + '/' + depData[k]['v'];
			}
		}
		var options = {
			host: MONUPCO_HOST,
			path: MONUPCO_REGISTER_PATH,
			method: 'POST',
			headers: {
				'User-Agent' : 'common-nodejs-monupco'
			}
		};
		if(thisModule || vendorModule){
			options.headers['User-Agent'] = vendorModule + ' ' + thisModule;
		}
		httpPost(options, postData, cb)
	});
}

module.exports.postToMonupco = postToMonupco;


// Command line tool implementation
function cli(){
	var printJSON = false;
	for(var i in process.argv) {
		if(process.argv[i] == "--debug") {
			dLog = function() {
				console.log.apply(this, arguments);
			}
		}
		if(process.argv[i] == "--dependenciesDebug") {
			dependenciesDebug = true;
		}
		if(process.argv[i] == "--printJSON") {
			printJSON = true;
		}
	}
	process.on('uncaughtException', function (err) {
		console.log(err.message);
	});
	if(printJSON){
		listDependencies(function(depData){
			var postData = getDepsAsJSON(depData);
			console.log(JSON.stringify(postData));
		});
		return;
	}
	dLog("Monupco: Strating...");
	try {
		postToMonupco(function(result, error){
			if(result) {
				console.log("Monupco: " + result['message']);
			} else {
				console.log("Monupco: " + error);
			}
		});
	} catch(e) {
	    console.log("Monupco client exception:");
		console.log(e.message);
	}
	dLog("Monupco: Done!");
}

module.exports.cli = cli;


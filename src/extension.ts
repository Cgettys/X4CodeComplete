// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { print, TextDecoder } from 'util';
var fs = require('fs');
var parser = require('xml2js');
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
var exceedinglyVerbose: boolean = false;
var rootpath: string;
var scriptPropertiesPath: string;
interface CompletionDict
{
    [key: string]: Set<string>;
}
interface LocationDict
{
	[key: string]: vscode.Location;
}

let completionDict: CompletionDict = {};
let locationDict: LocationDict = {};
function readScriptProperties(filepath: string){
	console.log("Attempting to read scriptproperties.xml");
	// Can't move on until we do this so use sync version
	let rawData = fs.readFileSync(filepath).toString();
	parser.parseString(rawData, function (err: any, result:any) {
		if (err !== null){
			vscode.window.showErrorMessage("Error during parsing of scriptproperties.xml:" + err);
		}

		let keywords = result["scriptproperties"]["keyword"];
		for (let i = 0; i < keywords.length; i++) {
			processKeyword(rawData, keywords[i]);
		}

		let datatypes = result["scriptproperties"]["datatype"];
		for (let j = 0; j < datatypes.length; j++) {
			processDatatype(rawData, datatypes[j]);
		}
		addToSet("boolean","==true");
		addToSet("boolean","==false");
		console.log("Parsed scriptproperties.xml");
	});
	return completionDict;
}

function addToSet(key:string, val:string){
    let k = cleanStr(key);
    let v = cleanStr(val);
    if (v in ["integer", "string", "float", ""]){
        return;
	}
    if (!(key in completionDict)) {
        completionDict[k] = new Set<string>();
	} 
	completionDict[k].add(v);
}

function cleanStr(val: string){
	return val.replace("[${}<>]","");
}

interface ScriptProperty {
	$:{
		name: string;
		result: string;
		type: string;
	};
}
function addToLocationDict(name: string, file: string, start: vscode.Position, end: vscode.Position){
	let range = new vscode.Range(start, end);
	let uri = vscode.Uri.parse("file://"+file);
	locationDict[name] = new vscode.Location(uri, range);
}

function determineLocation(rawData: string,name: string, tagType: string){
	let rawIdx = rawData.search("<"+tagType+" name=\""+ name+"\""+"[^>]*>");
	// make sure we don't care about platform & still count right https://stackoverflow.com/a/8488787
	let line = rawData.substr(0, rawIdx).split(/\r\n|\r|\n/).length-1;
	let startIdx = Math.max(rawData.lastIndexOf("\n", rawIdx),rawData.lastIndexOf("\r", rawIdx));
	let start = new vscode.Position(line, rawIdx - startIdx);
	let endIdx = rawData.indexOf(">", rawIdx)+2;
	let end = new vscode.Position(line, endIdx - rawIdx);
	addToLocationDict(name, scriptPropertiesPath, start, end);
}
function determinePropertyLocation(rawData: string, name:string, parent: string, parentType: string){
	let rawIdx = rawData.search("(?:<"+parentType+" name=\""+ parent+"\""+"[^>]*>.*)(<property name =\""+name+"\"[^>]*>)");
	// make sure we don't care about platform & still count right https://stackoverflow.com/a/8488787
	let line = rawData.substr(0, rawIdx).split(/\r\n|\r|\n/).length-1;
	let startIdx = Math.max(rawData.lastIndexOf("\n", rawIdx),rawData.lastIndexOf("\r", rawIdx));
	let start = new vscode.Position(line, rawIdx - startIdx);
	let endIdx = rawData.indexOf(">", rawIdx)+2;
	let end = new vscode.Position(line, endIdx - rawIdx);
	addToLocationDict(parent+"."+name, scriptPropertiesPath, start, end);
}

function processProperty(rawData: string, parent: string, parentType:string, prop:ScriptProperty){
	let name = prop.$.name;
	if (exceedinglyVerbose){
		console.log("\tProperty read: ", name);
	}
	determinePropertyLocation(rawData,name,parent, parentType);
	let splits = name.split(".");
	var last: string = parent;
	for (let i = 0; i < splits.length; i ++){
		let namePart = splits[i];
		if (namePart.match("[<>{}]")){
			if (exceedinglyVerbose){
				console.log("\t\tPoorly handled for now: ", namePart);
			}
			addToSet(last, namePart);
			last = namePart;
		} else {
			if (exceedinglyVerbose){
				console.log("\t\tEntry:"+last + ", "+ namePart);
			}
			addToSet(last, namePart);
			last = namePart;
		}
	}
}

interface Keyword{
	$:{
		name: string;
		type?: string;
		pseudo?: string;
	};
	property?:[ScriptProperty];
}

function processKeyword(rawData: string, e: Keyword){
	let name = e.$.name;
	determineLocation(rawData,name, "keyword");
	if (exceedinglyVerbose){
		console.log("Keyword read: " + name);
	}
	if (e.property === undefined){
		return;
	}
	e.property.forEach(prop => processProperty(rawData, name, "keyword", prop));
}

interface Datatype {
	$:{
		name: string;
		type?: string;
	};
	property?:[ScriptProperty];
}
function processDatatype(rawData: any, e: Datatype){
	let name = e.$.name;
	determineLocation(rawData,name, "datatype");
	if (exceedinglyVerbose)	{
		console.log("Datatype read: " + name);
	}
	if (e.property === undefined){
		return;
	}
	e.property.forEach(prop => processProperty(rawData, name, "datatype", prop));
}

function buildResultsIfMatches(prevToken:string, newToken: string, key:string, items: vscode.CompletionItem[]) {
    // convenience method to hide the ugliness
    if (!key.startsWith(newToken)) {
        return;
    }
    buildResults(prevToken, key, items, 0);
}

function buildResults(last:string, complete: string, items:vscode.CompletionItem[], depth:number){

	if (exceedinglyVerbose){
		console.log("\tBuilding results for: ", complete, "depth: ",depth, "last: ", last);
	}
	if (complete === ""){
		return;
	} 

	addItem(items, last, complete);
	if (depth > 3){
		return;
	}

	if (!(last in completionDict)){
		for (const possiblePartial in completionDict) {
			if (possiblePartial.indexOf(last)>-1 && possiblePartial !== last){
				let nextComplete = complete+"."+possiblePartial;
				if (nextComplete !== ""){
					addItem(items, last, nextComplete);
				}
				buildResults(nextComplete,nextComplete, items, depth+1);
			}
		}
		addItem(items, last, complete);
		return;
	}
	let nexts = (completionDict as any)[last];
	for (const next in nexts) {
		let nextComplete = complete+"."+nexts[next];
		buildResults(next,nextComplete, items, depth+1);
	}
}

function addItem(items:vscode.CompletionItem[], key: string, complete:string){
	if (complete === ""){
		return;
	}
	let result = new vscode.CompletionItem(complete);
	items.push(result);
}

function findRelevantPortion(text: string){
	let pos = Math.max(text.lastIndexOf("."), text.lastIndexOf('"'));
	if (pos === -1){
		return null;
	}
	let newToken = text.substr(pos + 1);
	let prevPos = Math.max(text.lastIndexOf(".", pos-1),text.lastIndexOf('"', pos-1));
	if (text.length - pos > 3 && prevPos === -1){
		return ["", newToken];
	}
	let prevToken = text.substr(prevPos + 1, pos-prevPos-1);
	return [prevToken, newToken];
}

export function activate(context: vscode.ExtensionContext) {

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let config = vscode.workspace.getConfiguration("x4CodeComplete");
	if (config === undefined){
		vscode.window.showErrorMessage("Could not read config!");
		return;
	}

	rootpath = config["unpackedFileLocation"];
	// really, typescript??? really?? https://stackoverflow.com/a/16215800
	if (rootpath === "") {
		vscode.window.showErrorMessage("You must configure the path to unpacked files! Do so & restart VS Code!");
		return;
	}
	exceedinglyVerbose = config["exceedinglyVerbose"];
	scriptPropertiesPath = rootpath + "/libraries/scriptproperties.xml";
	readScriptProperties(scriptPropertiesPath);
	let sel: vscode.DocumentSelector = { language: 'xml' };
	let completeProvider: vscode.CompletionItemProvider = {
		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {

			// get all text until the `position` and check if it reads `console.`
			// and iff so then complete if `log`, `warn`, and `error`
			
			let items: vscode.CompletionItem[]= [];
			let prefix= document.lineAt(position).text.substr(0, position.character);
			console.log(prefix);
			let interesting = findRelevantPortion(prefix);
			if (interesting === null){	
				if (exceedinglyVerbose){
					console.log("no relevant portion detected");
				}
				return new vscode.CompletionList(items,true);
			}
			let prevToken = interesting[0];
			let newToken = interesting[1];
					if (exceedinglyVerbose){
				console.log("Previous token: ",interesting[0], " New token: ",interesting[1]);
			}
			// If we have a previous token & it's in the dictionary, only use that's entries
			if (prevToken !== ""){
				if (!(prevToken in completionDict)) {
					if (exceedinglyVerbose){
						console.log("Missing previous token!");
					}
				} else {
					let possibilities =  completionDict[prevToken];
					possibilities.forEach( possibleMatch => {
						buildResultsIfMatches(prevToken,newToken, possibleMatch, items);
					});
					return new vscode.CompletionList(items,true);
				}
			}
			// Ignore tokens where all we have is a short string and no previous data to go off of
			if (prevToken === "" && newToken.length < 2){
				return new vscode.CompletionList(items,true);
			}

			// Otherwise fall back to looking at keys of the dictionary for the new string
			for (const key in completionDict) {
				if (key.startsWith(newToken)) {
					buildResultsIfMatches(prevToken,newToken, key, items);
				}
			}

			return new vscode.CompletionList(items,true);
		}
	};
	
	let disposableCompleteProvider = vscode.languages.registerCompletionItemProvider(sel,completeProvider,".","\"");

	context.subscriptions.push(disposableCompleteProvider);

	let definitionProvider: vscode.DefinitionProvider = {
		provideDefinition(document: vscode.TextDocument, position: vscode.Position){
			let line = document.lineAt(position).text;
			let start = Math.max(line.lastIndexOf("\"",position.character), line.lastIndexOf(".",position.character));
			let endA =  line.indexOf(".",position.character);
			let endB = line.indexOf("\"",position.character);
			var end;
			if (endA === -1 && endB === -1){
				end = -1;
			} else if (endA !== -1){
				end = endA;
			} else if (endB !== -1){
				end = endB;
			} else {
				end = Math.min(endA, endB);
			}
			let interesting = line.substr(start+1, end-start-1);
			if (exceedinglyVerbose) {
				console.log("Token:",interesting);
			}
			if (interesting in locationDict){
				return locationDict[interesting];
			}
			// TODO combine this logic with similar used elsewhere
			if (endA !== -1){
				let parts = findRelevantPortion(line);
				console.log(parts);
				if (parts !== null){
					let key = parts[0] + "." +parts[1];
					if (key in locationDict){
						return locationDict[key];
					}
				}
			}
			return undefined;
		}
	};
	let disposableDefinitionProvider = vscode.languages.registerDefinitionProvider(sel, definitionProvider);
	context.subscriptions.push(disposableDefinitionProvider);
}

// this method is called when your extension is deactivated
export function deactivate() {}

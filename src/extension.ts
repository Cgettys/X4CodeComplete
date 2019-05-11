// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { print } from 'util';
var fs = require('fs');
var parser = require('xml2js');
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
var exceedinglyVerbose: boolean = false;
interface CompletionDict
{
    [key: string]: Set<string>;
}

function readScriptProperties(filepath: string){
	let unique: CompletionDict = {};
	console.log("Attempting to read scriptproperties.xml");
	// Can't move on until we do this so use sync version
	let rawData = fs.readFileSync(filepath);
	parser.parseString(rawData, function (err: any, result:any) {
		if (err !== null){
			vscode.window.showErrorMessage("Error during parsing of scriptproperties.xml:" + err);
		}

		let keywords = result["scriptproperties"]["keyword"];
		for (let i = 0; i < keywords.length; i++) {
			processKeyword(unique, keywords[i]);
		}

		let datatypes = result["scriptproperties"]["datatype"];
		for (let j = 0; j < datatypes.length; j++) {
			processDatatype(unique, datatypes[j]);
		}
		addToSet(unique, "boolean","==true");
		addToSet(unique, "boolean","==false");
		console.log("Parsed scriptproperties.xml");
	});
	return unique;
}

function addToSet(unique: CompletionDict, key:string, val:string){
    let k = cleanStr(key);
    let v = cleanStr(val);
    if (v in ["integer", "string", "float", ""]){
        return;
	}
    if (!(key in unique)) {
        unique[k] = new Set<string>();
	} 
	unique[k].add(v);
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

function processProperty(unique: CompletionDict, parent: string, prop:ScriptProperty){
	if (exceedinglyVerbose){
		console.log("\tProperty read: ", prop.$.name);
	}
	let splits = prop.$.name.split(".");
	var last: string = parent;
	for (let i = 0; i < splits.length; i ++){
		let namePart = splits[i];
		if (namePart.match("[<>{}]")){
			if (exceedinglyVerbose){
				console.log("\t\tPoorly handled for now: ", namePart);
			}
			addToSet(unique, last, namePart);
			last = namePart;
		} else {
			if (exceedinglyVerbose){
				console.log("\t\tEntry:"+last + ", "+ namePart);
			}
			addToSet(unique, last, namePart);
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

function processKeyword(unique: CompletionDict, e: Keyword){
	let name = e.$.name;
	if (exceedinglyVerbose){
		console.log("Keyword read: " + name);
	}
	if (e.property === undefined){
		return;
	}
	e.property.forEach(prop => processProperty(unique, name, prop));
}

interface Datatype {
	$:{
		name: string;
		type?: string;
	};
	property?:[ScriptProperty];
}
function processDatatype(unique: CompletionDict, e: Datatype){
	let name = e.$.name;
	if (exceedinglyVerbose)	{
		console.log("Datatype read: " + name);
	}
	if (e.property === undefined){
		return;
	}
	e.property.forEach(prop => processProperty(unique, name, prop));
}

function buildResultsIfMatches(prevToken:string, newToken: string, key:string, data:CompletionDict, items: vscode.CompletionItem[]) {
    // convenience method to hide the ugliness
    if (!key.startsWith(newToken)) {
        return;
    }
    buildResults(data, prevToken, key, items, 0);
}

function buildResults(data: CompletionDict, last:string, complete: string, items:vscode.CompletionItem[], depth:number){

	if (exceedinglyVerbose){
		console.log("\tBuilding results for: ", complete, "depth: ",depth, "last: ", last);
	}
	addItem(items, last, complete);
	if (complete === "" && depth > 0){
		return;
	} 
	if (depth > 3){
		return;
	}

	if (!(last in data)){
		for (const possiblePartial in data) {
			if (possiblePartial.indexOf(last)>-1 && possiblePartial !== last){
				let nextComplete = complete+"."+possiblePartial;
				if (nextComplete !== ""){
					addItem(items, last, nextComplete);
				}
				buildResults(data, nextComplete,nextComplete, items, depth+1);
			}
		}
		addItem(items, last, complete);
		return;
	}
	let nexts = (data as any)[last];
	for (const next in nexts) {
		let nextComplete = complete+"."+nexts[next];
		buildResults(data, next,nextComplete, items, depth+1);
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
	let prevToken = text.substr(prevPos + 1, pos-1);
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

	let filepath = config["scriptPropertiesLocation"];
	// really, typescript??? really?? https://stackoverflow.com/a/16215800
	if (filepath === "") {
		vscode.window.showErrorMessage("You must configure the path to scriptproperties.xml! Do so & restart VS Code!");
		return;
	}
	exceedinglyVerbose = config["exceedinglyVerbose"];
	let data: CompletionDict = readScriptProperties(filepath);
	let sel: vscode.DocumentSelector = { language: 'xml' };
	let provider: vscode.CompletionItemProvider = {
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
				if (!(prevToken in data)) {
					if (exceedinglyVerbose){
						console.log("Missing previous token!");
					}
				} else {
					let possibilities =  data[prevToken];
					possibilities.forEach( possibleMatch => {
						buildResultsIfMatches(prevToken,newToken, possibleMatch, data, items,);
					});
					return new vscode.CompletionList(items,true);
				}
			}
			// Ignore tokens where all we have is a short string and no previous data to go off of
			if (prevToken === "" && newToken.length < 2){
				return new vscode.CompletionList(items,true);
			}

			// Otherwise fall back to looking at keys of the dictionary for the new string
			for (const key in data) {
				if (key.startsWith(newToken)) {
					buildResultsIfMatches(prevToken,newToken, key, data, items);
				}
			}

			return new vscode.CompletionList(items,true);
		}
	};
	
	let disposable = vscode.languages.registerCompletionItemProvider(sel,provider,".","\"");

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}

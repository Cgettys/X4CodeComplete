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

function findRelevantPortion(text: string){
	let pos = Math.max(text.lastIndexOf("."), text.lastIndexOf('"',text.length-2));
	if (pos === -1){
		return null;
	}
	let newToken = text.substr(pos + 1, text.length - pos - 1);
	if (newToken.endsWith("\"")){
		newToken = newToken.substr(0, newToken.length - 1);
	}
	let prevPos = Math.max(text.lastIndexOf(".", pos-1),text.lastIndexOf('"', pos-1));
	// TODO something better
	if (text.length - pos > 3 && prevPos === -1){
		return ["", newToken];
	}
	let prevToken = text.substr(prevPos + 1, pos-prevPos-1);
	return [prevToken, newToken];
}
class Literal {
	literal: string;
	type?:string;
	constructor(literal:string, type?:string){
		this.literal = literal;
		this.type = type;
	}
}
class CompletionDictEntry {
	literals:Set<Literal> = new Set<Literal>();
	supertypes:Set<string> = new Set<string>();
	addLiteral(value:string, type?:string){
		this.literals.add(new Literal(value, type));
	}
	addSupertype(value: string){
		this.supertypes.add(value);
	}
}

class CompletionDict implements vscode.CompletionItemProvider
{
	dict: Map<string,CompletionDictEntry> = new Map<string,CompletionDictEntry>();
	addLiteral(key:string, val:string): void{
		let k = cleanStr(key);
		let v = cleanStr(val);
		if (v in ["integer", "string", "float", ""]){
			return;
		}
		var entry = this.dict.get(k);
		if (entry === undefined) {
			entry = new CompletionDictEntry();
			this.dict.set(k, entry);
		}
		entry.addLiteral(v);
	}
	addSupertype(key:string, val:string): void{
		let k = cleanStr(key);
		let v = cleanStr(val);
		if (v in ["integer", "string", "float", ""]){
			return;
		}
		var entry = this.dict.get(k);
		if (entry === undefined) {
			entry = new CompletionDictEntry();
			this.dict.set(k, entry);
		}
		entry.addSupertype(v);
	}


	addItem(items:vscode.CompletionItem[], complete:string): void{
		if (complete === ""){
			return;
		}
		let result = new vscode.CompletionItem(complete);
		items.push(result);
	}	
	
	buildResultsIfMatches(prevToken:string, newToken: string, key:string, items: vscode.CompletionItem[]): void {
		// convenience method to hide the ugliness
		if (!key.startsWith(newToken)) {
			return;
		}
		this.buildResults(prevToken, key, items, 0);
	}
	
	buildResults(last:string, key: string, items:vscode.CompletionItem[], depth:number): void{
	
		if (exceedinglyVerbose){
			console.log("\tBuilding results for: ", key, "depth: ",depth, "last: ", last);
		}
		if (key === ""){
			return;
		} 
		let entry = this.dict.get(key);
		if (entry === undefined){
			return;
		}
	
		this.addItem(items, key);
		if (depth > 3){
			return;
		}
	
		for (const literal in entry.literals) {
			this.addItem(items, literal);
		}
		for (const supertype in entry.supertypes){
			this.buildResults(last, supertype, items, depth + 1);
		}
	}

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
			if (!(prevToken in this.dict.keys())) {
				if (exceedinglyVerbose){
					console.log("Missing previous token!");
				}
			} else {
				this.buildResultsIfMatches(prevToken, newToken, prevToken, items);
				return new vscode.CompletionList(items,true);
			}
		}
		// Ignore tokens where all we have is a short string and no previous data to go off of
		if (prevToken === "" && newToken.length < 2){
			return new vscode.CompletionList(items,true);
		}

		// Otherwise fall back to looking at keys of the dictionary for the new string
		for (const key of this.dict.keys()) {
			this.buildResultsIfMatches(prevToken,newToken, key, items);
		}
		return new vscode.CompletionList(items,true);
	}
}
	


class LocationDict implements vscode.DefinitionProvider
{
	dict: Map<string, vscode.Location> = new Map<string, vscode.Location>();

	addLocation(name: string, file: string, start: vscode.Position, end: vscode.Position): void{
		let range = new vscode.Range(start, end);
		let uri = vscode.Uri.parse("file://"+file);
		this.dict.set(cleanStr(name), new vscode.Location(uri, range));
	}
	addLocationForRegexMatch(rawData: string, rawIdx:number, name: string){
		// make sure we don't care about platform & still count right https://stackoverflow.com/a/8488787
		let line = rawData.substr(0, rawIdx).split(/\r\n|\r|\n/).length-1;
		let startIdx = Math.max(rawData.lastIndexOf("\n", rawIdx),rawData.lastIndexOf("\r", rawIdx));
		let start = new vscode.Position(line, rawIdx - startIdx);
		let endIdx = rawData.indexOf(">", rawIdx)+2;
		let end = new vscode.Position(line, endIdx - rawIdx);
		this.addLocation(name, scriptPropertiesPath, start, end);
	}

	addNonPropertyLocation(rawData: string,name: string, tagType: string): void{
		let rawIdx = rawData.search("<"+tagType+" name=\""+ escapeRegex(name)+"\"[^>]*>");
		this.addLocationForRegexMatch(rawData, rawIdx, name);
	}

	addPropertyLocation(rawData: string, name:string, parent: string, parentType: string) : void{
		let re = new RegExp("(?:<"+parentType+" name=\""+ escapeRegex(parent)+"\"[^>]*>.*?)(<property name=\""+escapeRegex(name) +"\"[^>]*>)","s");
		let matches = rawData.match(re);
		if (matches === null || matches.index === undefined){
			console.log("strangely couldn't find property named:",name,"parent:",parent);
			return;
		}
		let rawIdx = matches.index + matches[0].indexOf(matches[1]);
		this.addLocationForRegexMatch(rawData, rawIdx, name);
	}

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
		if (interesting in this.dict){
			return this.dict.get(interesting);
		}
		// TODO combine this logic with similar used elsewhere
		// TODO clean this up
		let parts = findRelevantPortion(line);
		console.log(parts);
		if (parts !== null){
			let key = parts[0] + "." +parts[1];
			return this.dict.get(key);
		}
		return undefined;
	}
}

let completionProvider = new CompletionDict();
let definitionProvider = new LocationDict();
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
		completionProvider.addLiteral("boolean","==true");
		completionProvider.addLiteral("boolean","==false");
		console.log("Parsed scriptproperties.xml");
	});
}


function cleanStr(text: string){
	return text.replace(/</g,"\&lt;").replace(/>/g,"\&gt;");
}
function escapeRegex(text: string){
	// https://stackoverflow.com/a/6969486
	return cleanStr(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

interface ScriptProperty {
	$:{
		name: string;
		result: string;
		type?: string;
	};
}
function processProperty(rawData: string, parent: string, parentType:string, prop:ScriptProperty){
	let name = prop.$.name;
	if (exceedinglyVerbose){
		console.log("\tProperty read: ", name);
	}
	definitionProvider.addPropertyLocation(rawData, name, parent, parentType);
	let splits = name.split(".");
	var last: string = parent;
	for (let i = 0; i < splits.length; i ++){
		let namePart = splits[i];
		if (namePart.match("[<>{}]")){
			if (exceedinglyVerbose){
				console.log("\t\tPoorly handled for now: ", namePart);
			}
			completionProvider.addLiteral(last, namePart);
			last = namePart;
		} else {
			if (exceedinglyVerbose){
				console.log("\t\tEntry: ("+last + ", "+ namePart+")");
			}
			completionProvider.addLiteral(last, namePart);
			last = namePart;
		}
		if (prop.$.type !== undefined) {
			completionProvider.addSupertype(last, prop.$.type);
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
	definitionProvider.addNonPropertyLocation(rawData,name, "keyword");
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
	definitionProvider.addNonPropertyLocation(rawData, name, "datatype");
	if (exceedinglyVerbose)	{
		console.log("Datatype read: " + name);
	}
	if (e.property === undefined){
		return;
	}
	e.property.forEach(prop => processProperty(rawData, name, "datatype", prop));
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
	
	let disposableCompleteProvider = vscode.languages.registerCompletionItemProvider(sel, completionProvider,".","\"");

	context.subscriptions.push(disposableCompleteProvider);
	
	let disposableDefinitionProvider = vscode.languages.registerDefinitionProvider(sel, definitionProvider);
	context.subscriptions.push(disposableDefinitionProvider);
}

// this method is called when your extension is deactivated
export function deactivate() {}

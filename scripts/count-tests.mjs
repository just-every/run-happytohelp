#!/usr/bin/env node
// Read source only: never import a test, start a Worker, or invoke a callback.
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const rootArgument=process.argv.indexOf('--root');
if(rootArgument>=0&&!process.argv[rootArgument+1])throw Error('--root requires a source directory');
const root=rootArgument>=0?resolve(process.argv[rootArgument+1]):resolve(dirname(fileURLToPath(import.meta.url)),'..');
const modules=new Map(),rows=[],unknown=[];
function source(file){
 file=resolve(file);if(modules.has(file))return modules.get(file);
 const tree=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true),bindings=new Map();
 const module={file,tree,bindings};modules.set(file,module);
 for(const statement of tree.statements){
  if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name))bindings.set(declaration.name.text,{node:declaration.initializer,module});
  if(ts.isImportDeclaration(statement)&&statement.moduleSpecifier.text.startsWith('.')){
   const target=resolve(dirname(file),statement.moduleSpecifier.text),named=statement.importClause?.namedBindings;
   if(existsSync(target)&&named&&ts.isNamedImports(named))for(const name of named.elements)bindings.set(name.name.text,{file:target,name:(name.propertyName||name.name).text});
  }
 }
 return module;
}
function value(node,module,scope={},seen=new Set()){
 if(!node)throw Error('missing expression');
 if(ts.isStringLiteralLike(node)||ts.isNumericLiteral(node))return ts.isNumericLiteral(node)?Number(node.text):node.text;
 if(node.kind===ts.SyntaxKind.TrueKeyword)return true;if(node.kind===ts.SyntaxKind.FalseKeyword)return false;if(node.kind===ts.SyntaxKind.NullKeyword)return null;
 if(ts.isParenthesizedExpression(node))return value(node.expression,module,scope,seen);
 if(ts.isIdentifier(node)){
  if(Object.hasOwn(scope,node.text))return scope[node.text];
  const binding=module.bindings.get(node.text),key=module.file+':'+node.text;
  if(!binding||seen.has(key))throw Error('unresolved '+node.text);
  const next=new Set([...seen,key]);
  if(binding.file){const imported=source(binding.file);return value(ts.factory.createIdentifier(binding.name),imported,{},next)}
  return value(binding.node,binding.module,scope,next);
 }
 if(ts.isArrayLiteralExpression(node))return node.elements.flatMap(element=>ts.isSpreadElement(element)?value(element.expression,module,scope,seen):[lazy(element,module,scope,seen)]);
 if(ts.isObjectLiteralExpression(node))return Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).map(property=>[property.name.text,lazy(property.initializer,module,scope,seen)]));
 if(ts.isPropertyAccessExpression(node))return value(node.expression,module,scope,seen)[node.name.text];
 if(ts.isElementAccessExpression(node))return value(node.expression,module,scope,seen)[value(node.argumentExpression,module,scope,seen)];
 if(ts.isTemplateExpression(node))return node.head.text+node.templateSpans.map(span=>String(value(span.expression,module,scope,seen))+span.literal.text).join('');
 if(ts.isConditionalExpression(node))return value(value(node.condition,module,scope,seen)?node.whenTrue:node.whenFalse,module,scope,seen);
 if(ts.isBinaryExpression(node)){
  const a=value(node.left,module,scope,seen),b=value(node.right,module,scope,seen);
  switch(node.operatorToken.kind){case ts.SyntaxKind.PlusToken:return a+b;case ts.SyntaxKind.EqualsEqualsEqualsToken:return a===b;case ts.SyntaxKind.ExclamationEqualsEqualsToken:return a!==b;case ts.SyntaxKind.InKeyword:return a in b;}
 }
 if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)){
  const {expression,name}=node.expression,args=node.arguments.map(arg=>value(arg,module,scope,seen));
  if(expression.getText(module.tree)==='Object'&&['entries','values','keys'].includes(name.text))return Object[name.text](args[0]);
  const receiver=value(expression,module,scope,seen);
  if(name.text==='entries'&&Array.isArray(receiver))return [...receiver.entries()];
  if(name.text==='slice'&&Array.isArray(receiver))return receiver.slice(...args);
 }
 throw Error('unresolved '+node.getText(module.tree).slice(0,100));
}
function lazy(node,module,scope,seen){try{return value(node,module,scope,seen)}catch{return {expression:node.getText(module.tree)}}}
function bind(pattern,item,scope){
 if(ts.isIdentifier(pattern))scope[pattern.text]=item;
 else if(ts.isArrayBindingPattern(pattern))pattern.elements.forEach((part,i)=>{if(ts.isBindingElement(part))bind(part.name,item[i],scope)});
 else throw Error('unsupported loop binding');
}
function walk(node,module,scope={},kind='runner'){
 // Callback loops carry data for one behavior; registration loops create tests.
 if(ts.isFunctionLike(node))return;
 if(ts.isForOfStatement(node)){
  let hasRegistration=false;function find(child){if(ts.isFunctionLike(child))return;if(ts.isCallExpression(child)&&['test','step'].includes(child.expression.getText(module.tree)))hasRegistration=true;ts.forEachChild(child,find)}find(node.statement);
  if(!hasRegistration)return;
  try{for(const item of value(node.expression,module,scope)){const next={...scope};bind(node.initializer.declarations[0].name,item,next);walk(node.statement,module,next,kind)}}catch(error){unknown.push({file:relative(root,module.file),line:module.tree.getLineAndCharacterOfPosition(node.getStart()).line+1,reason:error.message})}return;
 }
 if(ts.isConditionalExpression(node)){
  try{walk(value(node.condition,module,scope)?node.whenTrue:node.whenFalse,module,scope,kind)}catch(error){unknown.push({file:relative(root,module.file),reason:error.message})}return;
 }
 if(ts.isCallExpression(node)&&['test','step'].includes(node.expression.getText(module.tree))){
  const text=node.getText(module.tree),file=relative(root,module.file),line=module.tree.getLineAndCharacterOfPosition(node.getStart()).line+1;
  const group=/\bjourney\(/.test(text)||/historyScenarios/.test(text)||/steps\.slice\(/.test(text);
  const name=lazy(node.arguments[0],module,scope,new Set());
  rows.push({file,line,kind:node.expression.getText(module.tree)==='step'?'step':kind,name:typeof name==='string'?name:node.arguments[0].getText(module.tree),...(Object.keys(scope).length?{inputs:scope}:{}),group});return;
 }
 ts.forEachChild(node,child=>walk(child,module,scope,kind));
}
function files(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(resolve(directory,entry.name)):[resolve(directory,entry.name)])}
for(const file of files(resolve(root,'tests')).filter(file=>/\.[cm]?[jt]sx?$/.test(file))){
 const module=source(file),text=module.tree.text;
 const runner=/from ['"]node:test['"]/.test(text),phase=/\bphases\(import\.meta\.url\)/.test(text),history=/const test=.*historyScenarios\.push/.test(text);
 if(runner||phase||history)walk(module.tree,module,{},phase?'scenario':history?'history':'runner');
 // Standalone executables are counted once, even when several package aliases invoke them.
 // Helper modules export proofs and are already owned by their importing journey.
 else if(dirname(file)===resolve(root,'tests')&&/import assert from ['"]node:assert/.test(text)&&/\bawait\b/.test(text)){
  const checkpoints=[];
  function checkpoint(node){
   if(ts.isFunctionLike(node))return;
   if(ts.isCallExpression(node)&&node.expression.getText(module.tree)==='checks.push')checkpoints.push(node);
   ts.forEachChild(node,checkpoint);
  }
  checkpoint(module.tree);
  for(const node of checkpoints.length?checkpoints:[module.tree])rows.push({file:relative(root,file),line:module.tree.getLineAndCharacterOfPosition(node.getStart()).line+1,kind:'standalone',name:node===module.tree?relative(root,file):node.arguments[0].getText(module.tree),group:false});
 }
}
const total=kind=>rows.filter(row=>row.kind===kind).length;
const summary={runnerRegistrations:total('runner'),groupWrappers:rows.filter(row=>row.kind==='runner'&&row.group).length,scenarioChecks:total('scenario'),historyChecks:total('history'),erasureSteps:total('step'),standaloneChecks:total('standalone')};
summary.effectiveLeafChecks=rows.filter(row=>!row.group).length;
summary.cap=200;summary.overCap=Math.max(0,summary.effectiveLeafChecks-summary.cap);
const output={...summary,method:'Expand registration loops; replace journey/history/erasure group wrappers with their registered leaves; count a same-behavior matrix inside a leaf once; count named standalone checkpoints, otherwise one root assertion flow. Assertions are not tests. Helpers without separate registration are part of their owning flow.',unknown,...(process.argv.includes('--json')?{checks:rows}: {})};
console.log(JSON.stringify(output,null,2));
if(unknown.length||process.argv.includes('--check')&&summary.overCap)process.exitCode=1;

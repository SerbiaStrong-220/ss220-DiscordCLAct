const core = require('@actions/core');
const github = require('@actions/github');
const hookcord = require('hookcord');

const webhook_id = core.getInput('webhook_id');
const webhook_secret = core.getInput('webhook_secret');
const text = core.getInput('text');
const author = core.getInput('author');

var Hook = new hookcord.Hook()
    .login(webhook_id, webhook_secret);

const ReplaceData = new Map([
    ["add:", ":new:"],
    ["remove:", ":wastebasket:"],
    ["tweak:", ":sos::flag_al:"],
    ["fix:", ":tools:"]
]);

try {
    TrySendMessage(text, author);
} catch (error) {
    core.setFailed(error.message);
}

function TrySendMessage(text, author){
    if (typeof text !== 'string'){
        console.error(`Input text are not string!`);
        return;
    }

    if (typeof author !== 'string'){
        console.error(`Input author are not string!`);
        return;
    }

    var clStrings = ExtractCL(text);
    if (clStrings.length <= 0){
        console.info(`Does't found any cl string`);
        return;
    }

    for (clStr of clStrings){
        let authorsString = "Nothing";
        let authorsArray = ExtractAuthors(clStr);
        if (authorsArray === null || authorsArray.length <= 0){
            authorsString = `Автор: ${author}`;
        } else if (authorsArray.length === 1){
            authorsString = `Автор: ${authorsArray[0]}`;
        } else{
            authorsString = `Авторы:`
            for (let i = 0; i < authorsArray.length; i++){
                if (i !== authorsArray.length - 1){
                    authorsString += ` ${authorsArray[i]},`
                } else{
                    authorsString += ` ${authorsArray[i]}`
                }
            }
        }

        console.log(`${authorsString}`);
        let infoArray = ExtractInfoLines(clStr);
        if (infoArray === null || infoArray.length <= 0){
            console.info(`Doesn't found any info line`)
            continue;
        }

        console.info(`Found ${infoArray.length} info lines`)
        let infoText = "";
        for (let i = 0; i < infoArray.length; i++){
            let curInfo = infoArray[i];

            if (typeof curInfo !== 'string' ||
                curInfo === null || 
                curInfo === "") 
                continue;

            const dashRegex = /.*\s(?=\w+:)/g;

            curInfo = curInfo.replaceAll(dashRegex, "");
            for (let [key, value] of ReplaceData){
                curInfo = curInfo.replaceAll(key, value);
            }

            if (i != infoArray.length - 1){
                infoText += curInfo + "\n";
            }
            else{
                infoText += curInfo;
            }
        }

        if (infoText === ""){
            console.error(`Failed to generate the final info string`)
            continue;
        }

        Hook.setPayload({'embeds': [{
                "color": 14397510,
                'fields': [{
                'name': authorsString,
                'value': infoText
                }]
            }]})
            .fire()
            .then(response_object => {})
            .catch(error => {
                throw error;
        });
    }
}

function ExtractCL(text){
    const clregex = /^:cl:/g;

    let clIndexes = Array.from(text.matchAll(clregex));
    let clStrings = new Array();

    if (clIndexes.length <= 0) return clStrings;

    if (clIndexes.length === 1){
        clStrings[0] = text.substring(clIndexes[0].index, text.length - 1);
    }
    else{
        for (let i = 0; i < clIndexes.length; i++){
            if (i != clIndexes.length - 1){
                clStrings[i] = text.substring(clIndexes[i].index, clIndexes[i + 1].index);
            }
            else{
                clStrings[i] = text.substring(clIndexes[i].index, text.length - 1);
            }
        }
    }

    return clStrings;
}

function ExtractAuthors(text){
    const authorsLineRegex = /(?<=:cl:).*/g;
    const authorInLineRegex = /\w+/g;

    let authorLine = authorsLineRegex.exec(text)[0].trim();
    let authorInLineMathes = authorInLineRegex.exec(authorLine);
    if (authorInLineMathes === null) return null;

    let authorsArray = new Array();
    let i = 0;
    authorInLineMathes.forEach((match) =>{
        authorsArray[i] = match;
        i++;
    })

    return authorsArray;
}

function ExtractInfoLines(text){
    const infoLineRegex = /^-.*\w+:.*$/gm;

    let infoLineMatches = infoLineRegex.exec(text);
    if (infoLineMatches === null) return null;

    let infoLinesArray = new Array();
    let i = 0;
    infoLineMatches.forEach((match) =>{
        infoLinesArray[i] = match;
        i++
    })

    console.log(`${infoLinesArray[0]}`);
    console.log(`${infoLinesArray[1]}`);
    return infoLinesArray;
}
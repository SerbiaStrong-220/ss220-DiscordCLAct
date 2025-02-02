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
        let authors = "";
        let authorsArray = ExtractAuthors(clStr);

        if (authorsArray.length <= 0){
            console.info(`Doesn't found authors in CL, the user's login will be used instead.`)
        } else{
            console.info(`Found ${authorsArray.length} authors specified in the changelog`)
        }

        if (authorsArray === null || authorsArray.length <= 0){
            authors = `Автор: ${author}`;
        } else if (authorsArray.length === 1){
            authors = `Автор: ${authorsArray[0]}`;
        } else{
            authors = `Авторы:`
            for (let i = 0; i < authorsArray.length; i++){
                if (i !== authorsArray.length - 1){
                    authors += ` ${authorsArray[i]},`
                } else{
                    authors += ` ${authorsArray[i]}`
                }
            }
        }

        let infoArray = ExtractInfoLines(clStr);
        if (infoArray === null || infoArray.length <= 0){
            console.info(`Doesn't found any info line`)
            continue;
        }

        console.info(`Found ${infoArray.length} info lines`)
        let info = "";
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
                info += curInfo + "\n";
            }
            else{
                info += curInfo;
            }
        }

        if (info === ""){
            console.error(`Failed to generate the final info string`)
            continue;
        }

        console.info(`Output authors:${authors}\n`);
        console.info(`Output info:\n${info}\n`)
        Hook.setPayload({'embeds': [{
                "color": 14397510,
                'fields': [{
                'name': authors,
                'value': info
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
    if (typeof text !== 'string')
        return null;

    const clregex = /^:cl:/gm;

    let clMatches = Array.from(text.matchAll(clregex));
    console.info(`Found ${clMatches.length} changelogs`)

    let clStrings = new Array();
    if (clMatches.length <= 0) return clStrings;

    if (clMatches.length === 1){
        clStrings[0] = text.substring(clMatches[0].index, text.length - 1);
    }
    else{
        for (let i = 0; i < clMatches.length; i++){
            if (i != clMatches.length - 1){
                clStrings[i] = text.substring(clMatches[i].index, clMatches[i + 1].index);
            }
            else{
                clStrings[i] = text.substring(clMatches[i].index, text.length - 1);
            }
        }
    }

    return clStrings;
}

function ExtractAuthors(text){
    const authorsLineRegex = /(?<=:cl:).*/g;
    const authorInLineRegex = /\w+/g;

    let authorLine = authorsLineRegex.exec(text)[0].trim();

    let authorsArray = new Array();
    let i = 0;
    let authorInLineMathes;
    while(authorInLineMathes = authorInLineRegex.exec(authorLine)){
        authorsArray[i] = authorInLineMathes[0];
        i++
    }

    return authorsArray;
}

function ExtractInfoLines(text){
    const infoLineRegex = /^-.*\w+:.*$/gm;

    let infoLinesArray = new Array();
    let i = 0;
    let infoLineMatches;
    while(infoLineMatches = infoLineRegex.exec(text)){
        infoLinesArray[i] = infoLineMatches[0];
        i++;
    }

    return infoLinesArray;
}
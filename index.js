import { Octokit } from 'octokit';
import { getInput, setFailed } from '@actions/core';
import github from '@actions/github';
import { EmbedBuilder, WebhookClient } from 'discord.js';

const webhook_id = getInput('webhook_id');
const webhook_token = getInput('webhook_token');

const owner = getInput('owner');
const repo = getInput('repo');
const pull_number = getInput('pull_number');
const token = getInput('github_token');

const octokitClient = new Octokit({auth:token});
const webhookClient = new WebhookClient({ id: webhook_id, token: webhook_token });

const ReplaceData = new Map([
    ["add:", ":newspaper: "],
    ["remove:", ":scissors:"],
    ["tweak:", ":gear:"],
    ["fix:", ":tools:"]
]);

try {
    TrySendMessage();
} catch (error) {
    setFailed(error.message);
}

async function TrySendMessage(){
    const pull_request = await octokitClient.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner: owner,
        repo: repo,
        pull_number: pull_number
    });

    var text = pull_request.data.body;
    if (text === null){
        console.info(`Pull request body is empty. Nothing to extract`);
        return;
    }

    var author = pull_request.data.user.login;

    var embed = new EmbedBuilder().setColor(0x3CB371)
        .setTitle(pull_request.data.title)
        .setURL(pull_request.data.html_url);

    var clStrings = ExtractCL(text);
    if (clStrings.length <= 0){
        console.info(`Doesn't found any cl string`);
        return;
    }

    for (let clStr of clStrings){
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

        console.info(`\nOutput authors:${authors}\n`);
        console.info(`\nOutput info:\n${info}\n`)

        embed.addFields( { name: authors, value: info } );
    }

    let imageURL = ExtractImageURL(text);
    if (imageURL !== null){
        embed.setImage(imageURL);
    }

    webhookClient.send({
        embeds: [embed],
    });
}

function ExtractCL(text){
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

function ExtractImageURL(text){
    const imageURLRegex = /(?<=!\[[^!].+\]\().*(?=\))/;

    return imageURLRegex.exec(text)[0];
}
import { getInput, setFailed, warning } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { EmbedBuilder, WebhookClient } from 'discord.js';

const webhook_id = getInput('webhook_id');
const webhook_token = getInput('webhook_token');
const github_token = getInput('github_token');

const [owner, repo] = getInput('repo').split('/');
const pull_number = getInput('pull_number') === ''
    ? context.payload.pull_request.number
    : parseInt(getInput('pull_number'));

const client = getOctokit(github_token);
const webhookClient = new WebhookClient({ id: webhook_id, token: webhook_token });

const replaceData = new Map([
    ["add:", ":newspaper: "],
    ["remove:", ":scissors:"],
    ["tweak:", ":gear:"],
    ["fix:", ":tools:"]
]);

try {
    trySendMessage();
} catch (error) {
    setFailed(error.message);
}

async function trySendMessage(){
    console.info(`Attempt to send a GET-request to https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}\n`)
    const pull_request = await client.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner: owner,
        repo: repo,
        pull_number: pull_number
    });

    let text = pull_request.data.body;
    if (text === null){
        warning(`Pull request body is empty, nothing to extract`);
        return;
    }

    console.info(`Original message:\n${text.trim()}\n`);
    text = deleteGitComments(text);

    let author = pull_request.data.user.login;
    let authorInfoMap = extractAuthorsInfoMap(text, author);
    if (authorInfoMap === null || authorInfoMap.length <= 0) return;

    let title = `#${pull_request.data.number}: ${pull_request.data.title}`;
    let embed = new EmbedBuilder()
        .setColor(0x3CB371)
        .setTitle(title)
        .setURL(pull_request.data.html_url);

    for (let [key, value] of authorInfoMap){
        embed.addFields( { name: key, value: value } );
    }

    let imageURL = extractImageURL(text);
    if (imageURL !== null){
        embed.setImage(imageURL);
    }

    webhookClient.send({
        embeds: [embed],
    });
}

/**
 * @param {string} text
 * @param {string} author The author of the changes, which will be used unless otherwise specified in the changelog
 * @returns {Map<string, string> | null} 
 */
function extractAuthorsInfoMap(text, author = "Неизвестно"){
    var clStrings = extractCL(text);
    if (clStrings.length <= 0){
        warning(`Doesn't found any changelog`);
        return null;
    }

    console.info(`Found ${clStrings.length} changelogs`)
    let authorInfoMap = new Map();

    let clNumber = 0;
    for (let clStr of clStrings){
        clNumber++;

        let authors = "";
        let authorsArray = extractAuthors(clStr);

        if (authorsArray.length <= 0 || authorsArray === null){
            console.info(`Doesn't found authors in the CL#${clNumber}, the user's login will be used instead.`)
        } else{
            console.info(`Found ${authorsArray.length} authors in the CL#${clNumber}`)
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

        let infoArray = extractInfoLines(clStr);
        if (infoArray === null || infoArray.length <= 0){
            warning(`Doesn't found any info string in the CL#${clNumber}`)
            continue;
        }

        console.info(`Found ${infoArray.length} info strings in the CL#${clNumber}`)
        let info = "";
        for (let i = 0; i < infoArray.length; i++){
            let curInfo = infoArray[i];

            if (typeof curInfo !== 'string' ||
                curInfo === null || 
                curInfo === "") 
                continue;

            const dashRegex = /.*\s(?=\w+:)/g;

            curInfo = curInfo.replaceAll(dashRegex, "");
            for (let [key, value] of replaceData){
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
            console.error(`Failed to generate the final info string in the CL#${clNumber}`)
            continue;
        }

        console.info(`\nOutput message of the CL#${clNumber}:\n${authors}\n${info}\n`)
        authorInfoMap.set(authors, info);
    }

    if (authorInfoMap.length <= 0){
        warning(`Pull request contains :cl:, but after that doesn't contain any info string`);
        return null;
    }

    return authorInfoMap;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractCL(text){
    const clregex = /^:cl:|^\uD83C\uDD91/gm;

    let clMatches = Array.from(text.matchAll(clregex));

    let clStrings = new Array();
    if (clMatches.length <= 0) return clStrings;

    for (let i = 0; i < clMatches.length; i++){
        if (i != clMatches.length - 1){
            clStrings[i] = text.substring(clMatches[i].index, clMatches[i + 1].index - 1);
        }
        else{
            clStrings[i] = text.substring(clMatches[i].index);
        }
    }

    return clStrings;
}

/**
 * @param {string} text 
 * @returns {string[] | null}
 */
function extractAuthors(text){
    const authorsLineRegex = /(?<=:cl:).*|(?<=^\uD83C\uDD91).*/g;
    const authorInLineRegex = /\w+/g;

    let authorLine = authorsLineRegex.exec(text);
    if (authorLine === null) return null;

    authorLine = authorLine[0].trim();

    let authorsArray = new Array();
    let i = 0;
    let authorInLineMathes;
    while(authorInLineMathes = authorInLineRegex.exec(authorLine)){
        authorsArray[i] = authorInLineMathes[0];
        i++
    }

    return authorsArray;
}

/**
 * 
 * @param {string} text 
 * @returns {string[]}
 */
function extractInfoLines(text){
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

/**
 * @param {string} text 
 * @returns {string | null}
 */
function extractImageURL(text){
    const imageURLRegex = /(?<=!\[[^!].+\]\().*(?=\))/;

    let imageURL = imageURLRegex.exec(text);
    if (imageURL === null) return null;

    return imageURL[0].trim();
}

/**
 * @param {string} text
 * @returns {string}
 */
function deleteGitComments(text){
    const commentRegex = /<!--[\s\S]*?-->/gm;

    return text.replaceAll(commentRegex, '').trim();
}

import { error, getInput, setFailed, warning } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { AttachmentBuilder, Embed, EmbedBuilder, WebhookClient } from 'discord.js';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const webhook_id = getInput('webhook_id');
const webhook_token = getInput('webhook_token');
const github_token = getInput('github_token');

const [owner, repo] = getInput('repo').split('/');
const pull_number = getInput('pull_number') === ''
    ? context.issue.number
    : parseInt(getInput('pull_number'));

const client = getOctokit(github_token);
const webhookClient = new WebhookClient({ id: webhook_id, token: webhook_token });

const replaceData = new Map([
    ["add:", ":newspaper: "],
    ["remove:", ":scissors:"],
    ["tweak:", ":gear:"],
    ["fix:", ":tools:"]
]);

const supportedMediaExtensions = new Map([
    ["image", ["jpg", "png"]],
    ["video", ["mp4", "webm", "gif"]]
])

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
    const pr_url = pull_request.data.html_url;

    let text = pull_request.data.body;
    if (text === null){
        warning(`Pull request body is empty, nothing to extract`);
        return;
    }

    console.info(`Original message:\n${text.trim()}\n`);
    text = deleteGitComments(text);

    let author = pull_request.data.user.login;
    let authorInfoMap = extractAuthorsInfoMap(text, author);
    if (authorInfoMap === null || authorInfoMap.size <= 0) return;

    let title = `#${pull_request.data.number}: ${pull_request.data.title}`;
    var mainEmbed = new EmbedBuilder()
        .setColor(0x3CB371)
        .setTitle(title)
        .setURL(pr_url);

    for (let [key, value] of authorInfoMap){
        mainEmbed.addFields( { name: key, value: value } );
    }

    let attachments = new Array();
    let embeds = new Array();
    let media = await extractMedia(text);
    if (media.size > 0){
        console.info(`Found ${media.size} media`);
        
        if (media.size > 10){
            warning(`More than 10 media found, only the first 10 will be sent`);
        }

        let i = 0;
        media.forEach((mediaType, fileName) =>{
            if (i == 0){
                console.log(`Video name is ${fileName}`);
                let attachment = new AttachmentBuilder(path.join(__dirname, fileName), fileName);
                attachments[attachments.length] = attachment;
                mainEmbed = getVideoEmbed(fileName, pr_url, title);
                embeds[i] = mainEmbed;
            } else if (i < 10){
                var embed = new EmbedBuilder()
                .setURL(pr_url);
                embeds[i] = embed;
            }
            i++;
        })
    }
    else
        embeds[0] = mainEmbed;

    webhookClient.send({
        embeds: embeds,
        files: attachments
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
        if (authorsArray === null || authorsArray.length <= 0){
            console.info(`Doesn't found authors in the CL#${clNumber}, the user's login will be used instead.`)
            authors = `Автор: ${author}`;
        } else if (authorsArray.length === 1){
            console.info(`Found 1 author in the CL#${clNumber}`)
            authors = `Автор: ${authorsArray[0]}`;
        } else{
            console.info(`Found ${authorsArray.length} authors in the CL#${clNumber}`)
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

            const dashRegex = /\s*-\s*(?=\w+:)/g;

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

    if (authorInfoMap.size <= 0){
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
    const clregex = /(?<=\s*):cl:|(?<=\s*)\uD83C\uDD91/gm;

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

    let authorLine = authorsLineRegex.exec(text);
    if (authorLine === null) return null;

    authorLine = authorLine[0].trim();
    if (authorLine === "") return null;
    
    let authorsArray = authorLine.split(',');
    authorsArray.filter(a => a !== "");
    return authorsArray;
}

/**
 * 
 * @param {string} text 
 * @returns {string[]}
 */
function extractInfoLines(text){
    const infoLineRegex = /\s*-\s*\w+:.*$/gm;

    let infoLinesArray = new Array();
    let i = 0;
    let result;
    while((result = infoLineRegex.exec(text)) != null){
        infoLinesArray[i] = result[0];
        i++;
    }

    return infoLinesArray;
}

/**
 * @param {string} text
 * @returns {string}
 */
function deleteGitComments(text){
    const commentRegex = /<!--[\s\S]*?-->|<!--[\s\S]*/gm;

    return text.replaceAll(commentRegex, '').trim();
}

/**
 * @param {string} text 
 * @returns {Promise<Map<string, string>>}
 */
async function extractMedia(text){
    const urlRegex = /(http|https):\/\/[^)\]\s]+/gm;

    let mediaMap = new Map();
    let i = 0;
    let result;
    while((result = urlRegex.exec(text)) != null){
        let url = result[0];
        console.log(`Try get file type from ${url}`);
        let responce = await downloadMedia(url, __dirname, true);
        if (responce == null){
            continue;
        }
        
        mediaMap.set(responce.fileName, responce.mediaType);
        i++
    }

    return mediaMap;
}

/**
 * @param {string} url
 * @returns {Promise<{contentType: string, url: string} | null>}
 */
async function getUrlContentTypeRecursive(url){
    var type = null;
    var responce = await fetch(url);
    if (responce.redirected){
        warning(`Redirected, new url is ${responce.url}`);
        type = await getUrlContentTypeRecursive(responce.url);
    }
    else{
        type = responce.headers.get('Content-Type');
        if (type != null){
            let contentType = type.split('/')[1];
            console.log(`Url content type is ${contentType}`);
            type = {contentType: contentType, url: url};
        }
    }
    
    return type;
}

/**
 * @param {string?} contentType
 * @returns {string?>}
 */
function getMediaType(extension){
    if (extension == null){
        return null;
    }

    var type = null;
    supportedMediaExtensions .forEach((extensions, mediaType) => {
        if (extensions.includes(extension)){
            type = mediaType;
        }
    })

    if (type == null){
        warning(`Extension ${extension} doesn't supported`);
    }
    return type;
}

/**
 * 
 * @param {string} url 
 * @param {string} outputFolder
 * @param {boolean} recurcive
 * @returns {Promise<{mediaType: string, fileName: string} | null>}
 */
async function downloadMedia(url, outputFolder, recurcive = true){
    if (!fs.existsSync(outputFolder)){
        fs.mkdirSync(outputFolder, { recursive: true });
    }

    const response = await fetch(url);
    if (!response.ok){
        return null;
    }

    if (response.redirected && recurcive){
        warning(`Redirected, new url is ${response.url}`);
        return await downloadMedia(response.url, outputFolder, true);
    }

    let extension = response.headers.get('Content-Type')?.split('/')[1];
    let mediaType = getMediaType(extension);
    if (mediaType == null){
        return null;
    }

    console.log(`media type is ${mediaType}`);
    const fileName = "video.mp4";
    await downloadHttps(url);
    console.log('File downloaded');
    return {mediaType: mediaType, fileName: fileName};
}

/**
 * @param {string} videoName 
 * @param {string} url 
 * @param {string} title 
 * @returns {Embed}
 */
function getVideoEmbed(videoName, url, title){
    return {
        url: url,
        title: title,
        video: {
            url: `attachment://${videoName}`
        }
    }
}

/**
 * 
 * @param {string} url 
 * @returns {Promise<void>}
 */
function downloadHttps(url){
    return new Promise(resolve => {
        const savePath = path.join(__dirname, 'video.mp4');
        const file = fs.createWriteStream(savePath);
        const request = https.get(url, async response => {
            response.pipe(file);
            await waitForFinish(file);
            resolve();
        });
    });
}

function waitForFinish(writeStream) {
    return new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
    });
}
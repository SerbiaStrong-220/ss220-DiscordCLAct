import { error, getInput, setFailed, warning } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { AttachmentBuilder, EmbedBuilder, WebhookClient } from 'discord.js';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import https from 'https';
import util from 'util';
import crypto from 'crypto';

const writeFileAsync = util.promisify(fs.writeFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const webhook_id = getInput('webhook_id');
const webhook_token = getInput('webhook_token');
const webhook_username = 'SS220 Changelogger';
const webhook_avatarUrl = 'https://raw.githubusercontent.com/SerbiaStrong-220/ss220-DiscordCLAct/refs/heads/main/logo.png';

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

const MediaTypes = { Image: "image", Video: "video" }

const supportedMediaExtensions = new Map([
    [MediaTypes.Image, ["png", "jpg", "jpeg", "webp"]],
    [MediaTypes.Video, ["mp4", "webm", "gif", "mov", "ts", "mkv", "avi", "wmw"]]
])

const imageLimit = 10;
const videoLimit = 10;
const messageSizeLimit = 8388608; // 8 MB

class MediaData{
    /**
     * @param {string} name
     * @param {string} type
     * @param {number} size
     */
    constructor(name, type, size){
        this.name = name;
        this.type = type;
        this.size = size;
    }
}

try {
    await sendChangelog();
} catch (error) {
    setFailed(error.message);
}

async function sendChangelog(){
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
    text = deleteCLIgnore(text);
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
    let videoArray = new Array();
    let mediaMap = await extractMedia(text);
    mediaMap.forEach((mediaArray, mediaType) =>{
        if (mediaArray.length <= 0){
            return;
        }

        console.info(`Found ${mediaArray.length} media with type ${mediaType}`);
        switch (mediaType){
            case MediaTypes.Image:
                if (mediaArray.length > imageLimit){
                    warning(`More than ${imageLimit} images found, only the first ${imageLimit} will be sent`);
                }

                let i = 0;
                let messageSize = 0;
                mediaArray.forEach(media =>{
                    if (i > imageLimit){
                        return;
                    }

                    let newMessageSize = messageSize + media.size;
                    if (newMessageSize > messageSizeLimit){
                        warning(`${media.name} will exceed the message size by up to ${newMessageSize} bytes, which exceeds the limit of ${messageSizeLimit} bytes. Skip it`);
                        return;
                    }
                    messageSize = newMessageSize;

                    let attachment = new AttachmentBuilder(path.join(__dirname, media.name), media.name);
                    attachments[attachments.length] = attachment;
                    if (i == 0){
                        mainEmbed.setImage(`attachment://${media.name}`);
                        embeds[i] = mainEmbed;
                    }
                    else{
                        embeds[i] = new EmbedBuilder()
                            .setURL(pr_url)
                            .setImage(`attachment://${media.name}`);
                    }
                    i++;
                })
                break;
            case MediaTypes.Video:
                if (mediaArray.length > videoLimit){
                    warning(`More than ${videoLimit} images found, only the first ${videoLimit} will be sent`);
                }

                videoArray = mediaArray;
                break;
            default:
                break;
        }
    })

    if (embeds.length <= 0){
        embeds[0] = mainEmbed;
    }

    if (attachments.length > 0){
        webhookClient.send({
            username: webhook_username,
            avatarURL: webhook_avatarUrl,
            embeds: embeds,
            files: attachments
        });
    }
    else{
        webhookClient.send({
            username: webhook_username,
            avatarURL: webhook_avatarUrl,
            embeds: embeds
        });
    }

    sendVideos(videoArray);
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
 * @returns {string}
 */
function deleteCLIgnore(text){
    const tag = "CLIgnore";
    const CLIgnoreRegex = RegExp(`<!--${tag}-->[\\s\\S]*?<!--\/${tag}-->`, 'gm');

    return text.replaceAll(CLIgnoreRegex, '').trim();
}

/**
 * @param {string} text
 * @returns {Promise<Map<string, MediaData[]>>}
 */
async function extractMedia(text){
    const urlRegex = /(http|https):\/\/[^")\]\s]+/gm;

    let mediaMap = new Map();
    let i = 0;
    let result;
    while((result = urlRegex.exec(text)) != null){
        let url = result[0];
        console.log(`Media-loader: Try get media from ${url}`);
        let media = await downloadMedia(url, __dirname, true);
        if (media == null){
            console.log(`Media-loader: Skipped`);
            continue;
        }
        console.log(`Media-loader: Success`);

        if (mediaMap.has(media.type)){
            let array = mediaMap.get(media.type);
            array[array.length] = media;
            mediaMap.set(media.type, array);
        }
        else{
            mediaMap.set(media.type, [media]);
        }
        i++
    }

    return mediaMap;
}

/**
 *
 * @param {string} url
 * @param {string} outputFolder
 * @param {boolean} recursive
 * @returns {Promise<MediaData | null>}
 */
async function downloadMedia(url, outputFolder){
    if (!fs.existsSync(outputFolder)){
        fs.mkdirSync(outputFolder, { recursive: true });
    }

    try {
        const {extension, buffer} = await sendRequest(url);
        let size = buffer.length;

        console.log('Downloaded file size:', size);
        if (size > messageSizeLimit){
            warning(`File size in "${url}" is more than ${messageSizeLimit} bytes!`);
            return null;
        }

        let mediaType = getMediaType(extension);
        if (mediaType == null){
            warning(`Failed to get media type for "${extension}"!`)
            return null;
        }

        let fileName = generateFileName(extension);
        const savePath = path.join(outputFolder, fileName);
        await writeFileAsync(savePath, buffer);
        return new MediaData(fileName, mediaType, size);
    }
    catch (err){
        warning('Download failed:', err);
        return null;
    }
}

/**
 *
 * @param {string} fileUrl
 * @returns {Promise<{extension: string, buffer: Buffer<ArrayBuffer>}>}
 */
function sendRequest(fileUrl){
  return new Promise((resolve, reject) => {
    const url = new URL(fileUrl);

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0', // avoids some GitHub 403s
      }
    };

    const req = https.request(options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(sendRequest(res.headers.location));
      }

      let extension;
      let contentType = res.headers['content-type'];

      if (contentType.endsWith('/gif')){
        extension = 'gif';
      }
      else if (contentType.startsWith('image/')){
        extension = 'png';
      }
      else if (contentType.startsWith('video/')){
        extension = 'mp4';
      }

      if (extension == undefined || extension == null){
        reject(`Content-Type "${contentType}" doesn't supported!`);
      }

      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        resolve({extension: extension, buffer: Buffer.concat(data)});
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * @param {string?} extension
 * @returns {string?}
 */
function getMediaType(extension){
    if (extension == null){
        return null;
    }

    var type = null;
    supportedMediaExtensions.forEach((extensions, mediaType) => {
        if (extensions.includes(extension)){
            type = mediaType;
        }
    })

    return type;
}

/**
 *
 * @param {string} extension
 * @returns {string}
 */
function generateFileName(extension){
    const randomPart = crypto.randomBytes(4).toString('hex');
    const timestamp = Date.now();
    return `${randomPart}_${timestamp}.${extension}`;s
}

/**
 *
 * @param {MediaData[]} mediaArray
 */
function sendVideos(mediaArray){
    if (mediaArray.length <= 0){
        return;
    }

    let i = 0;
    let messageSize = 0;
    let attachment = new Array();
    mediaArray.forEach(media =>{
        if (i > videoLimit){
            return;
        }

        if (media.type !== MediaTypes.Video){
            return;
        }

        let newMessageSize = messageSize += media.size;
        if (newMessageSize > messageSizeLimit){
            warning(`${media.name} will exceed the message size by up to ${newMessageSize} bytes, which exceeds the limit of ${messageSizeLimit} bytes! Skiping it`);
            return;
        }
        messageSize = newMessageSize;

        attachment[attachment.length] = new AttachmentBuilder(path.join(__dirname, media.name), media.name);
        i++;
    })

    webhookClient.send({
        username: webhook_username,
        avatarURL: webhook_avatarUrl,
        files: attachment
    })
}

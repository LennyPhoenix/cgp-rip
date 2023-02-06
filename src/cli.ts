#!/usr/bin/env node

// Dependencies
import { program } from "commander"
import * as fs from "fs"
import { Book } from "./modules/Book.js"
import { FormatPageTemplate, VerboseLog } from "./modules/Utilities.js";
import chalk from "chalk"
import imageSize from "image-size";
import puppeteer from "puppeteer";
import PDFMerger from "pdf-merger-js";

// Vars
const PackageData = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8"))

// Program Data
program
    .name(PackageData.name)
    .description(PackageData.description)
    .version(PackageData.version);

// Creates the cookie jar
interface IConfigureOptions {
    file: string
}
interface IConfigureData {
    "ASP.NET_SessionId": string
}
{
    const Command = program.command("configure").description("Configure in order to be able to use")

    // Arguments
    Command.argument("<session-id>", "ASP.NET_SessionId")

    // Options 
    Command.option("-f, --file", "The path to the configuration file", "config.json")

    // Main functionality
    Command.action(async (SessionId: string, Options: IConfigureOptions) => {
        // Vars
        let config: IConfigureData = {
            "ASP.NET_SessionId": SessionId
        }
        const file = Options.file

        // See if we currently have a config
        if (fs.existsSync(file)) {
            config = JSON.parse(fs.readFileSync(file, "utf-8"))
        }

        // Add each cookie if it is inputted
        if (SessionId != "")
            config["ASP.NET_SessionId"] = SessionId

        // Output to file
        const FormattedJar = JSON.stringify(config)
        fs.writeFileSync(file, FormattedJar)

        //
        console.log(chalk.bgGreen("Done"))
    })
}

// Rips a book
interface IRipOptions {
    pages: string
    svg: boolean
    background: boolean
    merge: boolean
    pdf: boolean
    output: string
    file: string
    verbose: boolean
}
{
    const Command = program.command("rip").description("Rip an online book")

    // Arguments
    Command.argument("<book-id>", "The book's id")
    
    // Options
    Command.option("-p, --pages <number>", "The amount of pages to grab", "")
    Command.option("--pdf", "Creates a PDF", true)
    Command.option("-o, --output <directory>", "The output directory", "./")
    Command.option("-f, --file <directory>", "Config file path", "config.json")
    Command.option("-v, --verbose", "Output what it is doing", true)

    // Main functionality
    Command.action(async (BookId: string, Options: IRipOptions) => {
        // Make sure is configured
        if (!fs.existsSync(Options.file))
            throw(new Error("Not configured. Please run configure first."))
        
        // Vars
        const UserConfig = <IConfigureData>JSON.parse(fs.readFileSync(Options.file, "utf-8"))
        const { CloudFrontCookies } = await Book.GenerateCloudFront(BookId, UserConfig["ASP.NET_SessionId"])
        const Verbose = Options.verbose

        // Create the object
        const book = new Book({
            BookId,
            //SessionId: UserConfig["ASP.NET_SessionId"],
            CloudFront: CloudFrontCookies
        })

        // Make sure pages is a number
        const Pages = parseInt(Options.pages || (await book.GetPageCount()).toString())
        if (isNaN(Pages))
            throw(new Error("pages - number not given"))

        // Start puppeteer
        VerboseLog(Verbose, "Info", "Starting puppeteer")
        const browser = await puppeteer.launch()
        VerboseLog(Verbose, "Info", "Started puppeteer")

        // Vars
        // const Details: any = await book.GetDetails()
        const [ page ] = await browser.pages()
        const merger = new PDFMerger()

        // Doit
        for (let i = 1; i < Pages + 1; i++) {
            // Grab the svg and background
            const SVGBuffer = await book.GetSVG(i, Verbose, Options.output)
            const ImageBuffer = await book.GetBackground(i, Verbose, Options.output)

            // Convert to base64
            const SVGUrl = `data:image/svg+xml;base64, ${SVGBuffer.toString("base64")}`
            const ImageUrl = `data:image/${ImageBuffer.BackgroundFType == "JPEG" ? "jpeg" : "png"};base64, ${ImageBuffer.Background.toString("base64")}`
            
            // Creating the page
            // const Header = <string>Object.values(Details.headers)[i]
            const ImageDimensions = imageSize(ImageBuffer.Background)
            const Page = FormatPageTemplate(ImageDimensions.height?.toString() || "", ImageDimensions.width?.toString() || "", ImageUrl, SVGUrl)

            // Log
            VerboseLog(Verbose, "Info", `Converted to html for ${BookId}:${i}`)

            // Add to the merger
            await page.setContent(Page)
            merger.add(await page.pdf({
                height: ImageDimensions.height || 0,
                width: ImageDimensions.width || 0,
            }))

            // Done
            VerboseLog(Verbose, "Success", `Converted to a pdf and added to merger for ${BookId}:${i}`)
        }

        // Save
        await browser.close()
        await merger.save(`${Options.output}/${BookId}.pdf`)

        // Load pdf
        // Completed
        console.log(chalk.bgGreen("Done"))
    })
}

// Parse it all
program.parse(process.argv)
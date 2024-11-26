const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const https = require("https");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const axiosInstance = axios.create({
	httpsAgent: new https.Agent({
		rejectUnauthorized: false,
	}),
	timeout: 5000,
	headers: {
		"User-Agent":
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
	},
});

// Main search endpoint
app.get("/search/:token/:imdbId/:type/:langs", async (req, res) => {
	try {
		const { imdbId, type, langs } = req.params;
		const requestedLangs = langs.split("|");

		console.log(
			`Searching for: ${imdbId} (${type}) - Languages: ${requestedLangs.join(
				", "
			)}`
		);

		// Convert IMDB ID to title for search
		const imdbResponse = await axiosInstance.get(
			`https://www.omdbapi.com/?i=${imdbId}&apikey=${process.env.OMDB_API_KEY}`
		);
		const searchTitle = imdbResponse.data.Title;

		if (!searchTitle) {
			console.log("No title found for IMDB ID:", imdbId);
			return res.json([]);
		}

		const searchUrl = `https://titlovi.com/titlovi/?prijevod=${encodeURIComponent(
			searchTitle
		)}&sort=4`;
		console.log("Searching titlovi.com:", searchUrl);

		const response = await axiosInstance.get(searchUrl);
		const $ = cheerio.load(response.data);

		const subtitles = [];

		// Ažurirani selektori prema stvarnoj strukturi stranice
		$("ul.titlovi > li.subtitleContainer").each((_, elem) => {
			const $elem = $(elem);

			// Izvuci jezik iz img.lang alt atributa
			const langImg = $elem.find("img.lang");
			const langAlt = langImg.attr("alt");

			// Mapiranje alt atributa u jezike
			const langMap = {
				3: "English",
				4: "Hrvatski",
				5: "Makedonski",
				6: "Slovenski",
				7: "Srpski",
			};

			const lang = langMap[langAlt];

			// Proveri da li je jezik među traženim
			if (requestedLangs.includes(lang)) {
				const title = $elem.find("h3 a").text().trim();
				const downloadLink = $elem.find(".download a").attr("href");
				const fps = $elem.find("span.fps").text().replace("fps: ", "").trim();
				const downloads = $elem.find("span.downloads").text().trim();

				if (downloadLink) {
					subtitles.push({
						id: downloadLink.split("-").pop().replace("/", ""),
						link_srt: `https://titlovi.com${downloadLink}`,
						lang,
						title,
						fps: fps !== "N/A" ? fps : null,
						downloads: parseInt(downloads) || 0,
					});
				}
			}
		});

		console.log(`Found ${subtitles.length} subtitles`);
		res.json(subtitles);
	} catch (error) {
		console.error("Error:", error);
		res.status(500).json({
			error: "Failed to fetch subtitles",
			message: error.message,
		});
	}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});

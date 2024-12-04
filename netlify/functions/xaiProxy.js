const fs = require('fs');
const path = require('path');
const Nodehun = require('nodehun');
const fetch = require('node-fetch');

// Load Swedish dictionaries
const affPath = path.resolve(__dirname, 'sv_SE.aff');
const dicPath = path.resolve(__dirname, 'sv_SE.dic');

// Add logging to confirm file paths
console.log('Loading Swedish dictionary files...');
console.log(`AFF file path: ${affPath}`);
console.log(`DIC file path: ${dicPath}`);

let affix, dictionary;

try {
    // Read dictionary files
    affix = fs.readFileSync(affPath);
    dictionary = fs.readFileSync(dicPath);
    console.log('Dictionary files loaded successfully.');
} catch (error) {
    console.error('Error loading dictionary files:', error.message);
    throw new Error('Failed to load dictionary files.');
}

// Initialize Hunspell
let hunspell;
try {
    hunspell = new Nodehun(affix, dictionary);
    console.log('Hunspell initialized successfully.');
} catch (error) {
    console.error('Error initializing Hunspell:', error.message);
    throw new Error('Failed to initialize Hunspell.');
}

exports.handler = async (event) => {
    const API_KEY = process.env.XAI_API_KEY;

    if (!API_KEY) {
        console.error('Error: XAI_API_KEY is missing.');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'XAI_API_KEY is missing from environment variables.' }),
        };
    }

    let { userInput, proficiency, topic } = JSON.parse(event.body || '{}');

    // Validate inputs
    if (!userInput) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing user input.' }),
        };
    }

    // Determine proficiency prompt
    let proficiencyPrompt = '';
    switch (proficiency) {
        case 'beginner':
            proficiencyPrompt = 'Use simple Swedish with short sentences and basic vocabulary.';
            break;
        case 'intermediate':
            proficiencyPrompt = 'Use intermediate Swedish with common phrases and slightly longer sentences.';
            break;
        case 'advanced':
            proficiencyPrompt = 'Use advanced Swedish with complex sentence structures and rich vocabulary.';
            break;
        default:
            proficiencyPrompt = 'Use simple Swedish.';
    }

    // Determine topic prompt
    let topicPrompt = '';
    switch (topic) {
        case 'greetings':
            topicPrompt = 'Focus on greetings and small talk, such as introducing yourself or asking how someone is.';
            break;
        case 'ordering-food':
            topicPrompt = 'Focus on phrases and vocabulary related to ordering food at a restaurant or cafe.';
            break;
        case 'travel-phrases':
            topicPrompt = 'Focus on travel phrases, such as asking for directions, transportation, or help.';
            break;
        default:
            topicPrompt = 'Provide general Swedish practice.';
    }

    try {
        // Call xAI API
        console.log('Calling xAI API...');
        const response = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
            },
            body: JSON.stringify({
                messages: [
                    {
                        role: 'system',
                        content: `You are a Swedish tutor. Adjust your responses based on the following:
                        - Proficiency: ${proficiencyPrompt}
                        - Topic: ${topicPrompt}`,
                    },
                    { role: 'user', content: userInput },
                ],
                model: 'grok-beta',
                stream: false,
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            console.error(`xAI API error: ${response.status} ${response.statusText}`);
            throw new Error(`xAI API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('xAI API response received.');

        // Check spelling errors in the user's input
        const corrections = await getCorrections(userInput);

        return {
            statusCode: 200,
            body: JSON.stringify({
                ...data,
                corrections, // Attach corrections to the response
            }),
        };
    } catch (error) {
        console.error('Error in xaiProxy handler:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to fetch data from xAI API or process input.', details: error.message }),
        };
    }
};

/**
 * Function to detect spelling errors and suggest corrections.
 */
async function getCorrections(input) {
    const words = input.split(/\s+/);
    const corrections = [];

    for (const word of words) {
        try {
            // Check if the word is spelled correctly
            const isCorrect = await new Promise((resolve, reject) => {
                hunspell.spell(word, (err, correct) => (err ? reject(err) : resolve(correct)));
            });

            if (!isCorrect) {
                // Get suggestions for the misspelled word
                const suggestions = await new Promise((resolve, reject) => {
                    hunspell.suggest(word, (err, suggestionList) => (err ? reject(err) : resolve(suggestionList)));
                });

                if (suggestions.length > 0) {
                    corrections.push({ word, suggestion: suggestions[0] }); // Use the first suggestion
                }
            }
        } catch (error) {
            console.error(`Error processing word "${word}":`, error.message);
            corrections.push({ word, suggestion: null }); // Add null suggestion if an error occurs
        }
    }

    return corrections;
}

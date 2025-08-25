import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, onSnapshot, query, orderBy, getDocs, Timestamp } from 'firebase/firestore';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Sun, CloudLightning, Activity, AlertTriangle, User, Moon, Sparkles, Satellite } from 'lucide-react'; // Icons from lucide-react

// --- Firebase Initialization ---
// MANDATORY: Use global variables provided by Canvas for Firebase configuration
// If running outside Canvas, provide a fallback firebaseConfig object
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    // Fallback config for local development if not in Canvas
    apiKey: "YOUR_FALLBACK_API_KEY", // Replace with your actual Firebase API Key
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID",
    measurementId: "YOUR_MEASUREMENT_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Global variables to store the current user's ID and indicate auth readiness
let currentUserId = null;
let isAuthReady = false;

// Context to provide Firebase state to other components
const FirebaseContext = createContext(null);

// Auth state observer for setting global variables and signing in
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserId = user.uid;
        console.log("Firebase User ID:", currentUserId);
    } else {
        console.log("No Firebase user is signed in.");
        // Generate a random UUID for unauthenticated users if no __initial_auth_token
        currentUserId = crypto.randomUUID();
        console.log("Assigned anonymous user ID:", currentUserId);
    }
    isAuthReady = true; // Auth state has been determined
    console.log("Firebase Auth is ready. User ID:", currentUserId);
});

// Initial sign-in logic to ensure an authenticated user for Firestore rules
(async () => {
    try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
            console.log("Signed in with custom token.");
        } else {
            await signInAnonymously(auth);
            console.log("Signed in anonymously.");
        }
    } catch (error) {
        console.error("Error during initial Firebase sign-in:", error);
    }
})();


// --- Utility: NASA DONKI API Fetcher with Exponential Backoff ---
// Using DEMO_KEY for simplicity. In production, consider getting your own key for higher limits.
const NASA_API_KEY = 'DEMO_KEY';
const NASA_DONKI_BASE_URL = 'https://api.nasa.gov/DONKI';

async function fetchWithBackoff(url, retries = 5, delay = 1000) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            // If API rate limit or other error, retry
            if (response.status === 429 && retries > 0) {
                console.warn(`Rate limit hit or API error (${response.status}). Retrying in ${delay / 1000}s... (Retries left: ${retries})`);
                await new Promise(res => setTimeout(res, delay));
                return fetchWithBackoff(url, retries - 1, delay * 2); // Exponential backoff
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Fetch with backoff failed:", error);
        throw error;
    }
}

// Function to fetch and process space weather data from NASA DONKI
async function fetchAndProcessSpaceWeatherData() {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 7); // Fetch data for the last 7 days for historical context

    const formatDate = (date) => date.toISOString().split('T')[0];
    const formattedStartDate = formatDate(startDate);
    const formattedEndDate = formatDate(today);

    try {
        // Fetch Solar Flares
        const flares = await fetchWithBackoff(`${NASA_DONKI_BASE_URL}/FLR?startDate=${formattedStartDate}&endDate=${formattedEndDate}&api_key=${NASA_API_KEY}`);
        // Fetch Coronal Mass Ejections (CMEAnalysis for more details)
        const cmes = await fetchWithBackoff(`${NASA_DONKI_BASE_URL}/CMEAnalysis?startDate=${formattedStartDate}&endDate=${formattedEndDate}&mostAccurateOnly=true&speed=0&halfAngle=0&api_key=${NASA_API_KEY}`);
        // Fetch Geomagnetic Storms
        const gst = await fetchWithBackoff(`${NASA_DONKI_BASE_URL}/GST?startDate=${formattedStartDate}&endDate=${formattedEndDate}&api_key=${NASA_API_KEY}`);

        // Combine and simplify data, grouping by hour for consistent charting
        const processedData = {};

        flares.forEach(flare => {
            const time = new Date(flare.beginTime);
            time.setMinutes(0, 0, 0); // Normalize to the hour
            const timeKey = time.toISOString();
            if (!processedData[timeKey]) processedData[timeKey] = { timestamp: time.toISOString() };
            processedData[timeKey].solarFlareCount = (processedData[timeKey].solarFlareCount || 0) + 1;
            // Convert class (e.g., C3.4) to a numeric value for intensity
            if (flare.classType) {
                const classLetter = flare.classType.charCodeAt(0) - 'A'.charCodeAt(0); // A=0, B=1, C=2...
                const classNumber = parseFloat(flare.classType.slice(1));
                processedData[timeKey].maxFlareIntensity = Math.max(processedData[timeKey].maxFlareIntensity || 0, classLetter * 10 + classNumber);
            }
        });

        cmes.forEach(cme => {
            const time = new Date(cme.startTime);
            time.setMinutes(0, 0, 0);
            const timeKey = time.toISOString();
            if (!processedData[timeKey]) processedData[timeKey] = { timestamp: time.toISOString() };
            processedData[timeKey].cmeCount = (processedData[timeKey].cmeCount || 0) + 1;
            if (cme.speed) {
                processedData[timeKey].maxCmeSpeed = Math.max(processedData[timeKey].maxCmeSpeed || 0, cme.speed);
            }
        });

        gst.forEach(storm => {
            const time = new Date(storm.startTime);
            time.setMinutes(0, 0, 0);
            const timeKey = time.toISOString();
            if (!processedData[timeKey]) processedData[timeKey] = { timestamp: time.toISOString() };
            if (storm.kpIndex) {
                processedData[timeKey].geomagneticStormLevel = Math.max(processedData[timeKey].geomagneticStormLevel || 0, storm.kpIndex);
            }
        });

        // Generate a continuous hourly series for the chart, filling gaps with zero activity
        const hourlyDataPoints = [];
        let currentTime = new Date(startDate);
        currentTime.setMinutes(0);
        currentTime.setSeconds(0);
        currentTime.setMilliseconds(0);

        while (currentTime <= today) {
            const timeKey = currentTime.toISOString();
            hourlyDataPoints.push({
                timestamp: currentTime.toISOString(),
                solarFlareCount: processedData[timeKey]?.solarFlareCount || 0,
                maxFlareIntensity: processedData[timeKey]?.maxFlareIntensity || 0,
                cmeCount: processedData[timeKey]?.cmeCount || 0,
                maxCmeSpeed: processedData[timeKey]?.maxCmeSpeed || 0,
                geomagneticStormLevel: processedData[timeKey]?.geomagneticStormLevel || 0,
            });
            currentTime.setHours(currentTime.getHours() + 1);
        }

        return hourlyDataPoints;

    } catch (error) {
        console.error("Error fetching NASA DONKI data:", error);
        throw error;
    }
}

// --- Utility: Celestial Events Generator (Client-side simulation for hackathon context) ---
// Provides dynamic, date-relevant text for celestial observations.
function getCelestialEventsTonight() {
    const today = new Date();
    const day = today.getDate();
    const month = today.toLocaleString('default', { month: 'long' });
    const year = today.getFullYear();
    const dayOfWeek = today.toLocaleString('default', { weekday: 'long' });

    // Simplified Moon Phase (very rough estimation for dynamic text, not precise calculation)
    const moonPhaseIndex = day % 29; // Cycle roughly every 29 days
    let moonPhase = "waxing crescent";
    if (moonPhaseIndex > 20) moonPhase = "waning gibbous";
    else if (moonPhaseIndex > 14) moonPhase = "full";
    else if (moonPhaseIndex > 7) moonPhase = "waxing gibbous";
    else if (moonPhaseIndex > 0) moonPhase = "new moon";

    // Dynamic planets near moon/prominent in sky (simplified)
    const planetsNearMoon = ['Mars', 'Jupiter', 'Saturn', 'Venus'][Math.floor(Math.random() * 4)];
    const brightStar = ['Spica', 'Aldebaran', 'Regulus', 'Sirius', 'Arcturus'][Math.floor(Math.random() * 5)];

    // Common constellations/asterisms relevant to different seasons
    const asterisms = [
        `Summer Triangle (Deneb, Vega, Altair) high in the sky`,
        `Orion the Hunter (Betelgeuse, Rigel) rising in the east`,
        `Ursa Major (The Big Dipper) easily visible overhead`,
        `Cassiopeia (The 'W' or 'M') prominent in the northern sky`,
        `Pleiades (Seven Sisters) sparkling brightly`,
        `Lyra (with bright Vega) directly overhead`,
        `Scorpius (with red Antares) low in the south`,
    ];
    const prominentAsterism = asterisms[Math.floor(Math.random() * asterisms.length)];

    return `Tonight, ${dayOfWeek}, ${month} ${day}${day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th'}, ${year}, the ${moonPhase} moon will be near ${planetsNearMoon} and the bright star ${brightStar} in the western sky shortly after sunset. You can also find the ${prominentAsterism}, a vast asterism of bright stars, high in the sky after dark. To get a more precise view from your location, use a sky map app like those found on Google Play or the interactive tool at sky-tonight.com.`;
}


// --- React Components for the Website ---

// Header component - Advanced, space-themed look
const Header = () => {
    const { userId } = useContext(FirebaseContext);
    return (
        <header className="bg-space-medium text-white p-4 shadow-xl border-b border-celestial-blue/30">
            <div className="container mx-auto flex flex-col sm:flex-row justify-between items-center">
                <h1 className="text-3xl font-extrabold flex items-center gap-2 mb-2 sm:mb-0 text-solar-yellow hover:text-white transition-colors duration-300">
                    <Sun className="h-8 w-8 text-solar-orange animate-pulse" />
                    Space Weather HQ
                </h1>
                {userId && (
                    <div className="flex items-center text-sm bg-space-light px-3 py-1 rounded-full shadow-inner border border-celestial-blue/20">
                        <User className="h-4 w-4 mr-2 text-celestial-blue" />
                        <span className="text-gray-300">User ID:</span> <span className="font-mono ml-1 text-gray-100 truncate max-w-[150px] sm:max-w-none">{userId}</span>
                    </div>
                )}
            </div>
        </header>
    );
};

// Loading state component with a space theme
const LoadingSpinner = () => (
    <div className="flex flex-col justify-center items-center h-screen bg-space-dark text-celestial-blue">
        <Satellite className="h-20 w-20 animate-spin-slow text-celestial-blue-300 mb-4" /> {/* Custom icon and animation */}
        <p className="ml-4 text-xl font-semibold">Initiating Deep Space Scan... Fetching Real-time Data.</p>
    </div>
);

// Error message component with a themed warning
const ErrorMessage = ({ message }) => (
    <div className="bg-solar-red/20 border border-solar-red text-solar-red px-6 py-4 rounded-xl relative text-center shadow-lg mx-auto max-w-2xl mt-8">
        <strong className="font-bold flex items-center justify-center gap-2 text-lg">
            <AlertTriangle className="h-6 w-6" /> Warning!
        </strong>
        <span className="block mt-2 text-sm">{message}</span>
    </div>
);

// Alert Box for Space Weather Prediction - Advanced UI
const AlertBox = ({ prediction }) => {
    const { level, message, details } = prediction;
    let bgColor = 'bg-green-700/20 border-green-500 text-green-300';
    let icon = <Activity className="h-8 w-8 text-green-400 animate-pulse-slow" />;
    let title = 'Nominal Conditions';
    let pulseClass = '';

    if (level === 'Minor') {
        bgColor = 'bg-solar-yellow/20 border-solar-yellow text-solar-yellow';
        icon = <CloudLightning className="h-8 w-8 text-solar-yellow animate-bounce-custom" />;
        title = 'Minor Solar Activity Advisory';
        pulseClass = 'animate-pulse';
    } else if (level === 'Moderate') {
        bgColor = 'bg-solar-orange/20 border-solar-orange text-solar-orange';
        icon = <AlertTriangle className="h-8 w-8 text-solar-orange animate-pulse" />;
        title = 'Moderate Space Weather Watch';
        pulseClass = 'animate-pulse-fast';
    } else if (level === 'Severe') {
        bgColor = 'bg-solar-red/20 border-solar-red text-solar-red';
        icon = <AlertTriangle className="h-8 w-8 text-solar-red animate-ping-strong" />;
        title = 'SEVERE SPACE WEATHER ALERT!';
        pulseClass = 'animate-pulse-critical';
    }

    return (
        <div className={`${bgColor} px-8 py-6 rounded-xl shadow-xl border-2 ${pulseClass} transition-all duration-300 ease-in-out`}>
            <div className="flex items-center mb-3">
                {icon}
                <h3 className="text-2xl font-bold ml-4">{title}</h3>
            </div>
            <p className="text-xl mb-2">{message}</p>
            {details && <p className="text-sm italic opacity-80">{details}</p>}
        </div>
    );
};

// Current Conditions Display - Space-themed card
const CurrentConditions = ({ latestData }) => {
    if (!latestData) return null;

    return (
        <div className="bg-space-medium p-6 rounded-xl shadow-lg flex-1 min-w-0 md:min-w-[320px] border border-celestial-blue/20">
            <h2 className="text-2xl font-bold text-solar-yellow mb-4 flex items-center gap-2">
                <Sun className="h-6 w-6 text-solar-orange" /> Current Space Conditions
            </h2>
            <div className="space-y-3 text-gray-200">
                <p className="flex justify-between items-center text-lg border-b border-gray-700 pb-2">
                    <span className="font-medium">Timestamp:</span>
                    <span className="font-mono text-gray-300">{new Date(latestData.timestamp).toLocaleString()}</span>
                </p>
                <p className="flex justify-between items-center text-lg">
                    <span className="font-medium">Solar Flares (past hr):</span>
                    <span className="text-solar-yellow font-semibold">{latestData.solarFlareCount || 0}</span>
                </p>
                <p className="flex justify-between items-center text-lg">
                    <span className="font-medium">Max Flare Intensity:</span>
                    <span className="text-solar-orange font-semibold">{latestData.maxFlareIntensity ? latestData.maxFlareIntensity.toFixed(1) : 'N/A'}</span>
                </p>
                <p className="flex justify-between items-center text-lg">
                    <span className="font-medium">CMEs (past hr):</span>
                    <span className="text-celestial-blue font-semibold">{latestData.cmeCount || 0}</span>
                </p>
                <p className="flex justify-between items-center text-lg">
                    <span className="font-medium">Max CME Speed (km/s):</span>
                    <span className="text-celestial-blue font-semibold">{latestData.maxCmeSpeed ? latestData.maxCmeSpeed.toFixed(0) : 'N/A'}</span>
                </p>
                <p className="flex justify-between items-center text-lg">
                    <span className="font-medium">Geomagnetic Kp Index:</span>
                    <span className="text-purple-300 font-semibold">{latestData.geomagneticStormLevel ? latestData.geomagneticStormLevel.toFixed(0) : 'N/A'}</span>
                </p>
            </div>
        </div>
    );
};

// Celestial Events Tonight Card - Space-themed UI
const CelestialEvents = ({ celestialEventsText }) => (
    <div className="bg-gradient-to-br from-celestial-blue to-purple-800 text-white p-6 rounded-xl shadow-lg flex-1 min-w-0 md:min-w-[320px] border border-celestial-blue/40">
        <h2 className="text-2xl font-bold flex items-center gap-2 mb-4">
            <Moon className="h-6 w-6 text-indigo-300" />
            Celestial Events Tonight
        </h2>
        <p className="text-md leading-relaxed opacity-90">
            {celestialEventsText}
        </p>
        <p className="text-xs mt-4 opacity-75">
            <Sparkles className="inline-block h-3 w-3 mr-1 text-purple-300" />
            (Info is dynamically generated for daily relevance.)
        </p>
    </div>
);


// Main Dashboard component
const Dashboard = () => {
    const { db, userId, isAuthReady } = useContext(FirebaseContext);
    const [spaceWeatherData, setSpaceWeatherData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [prediction, setPrediction] = useState({ level: 'Normal', message: 'All systems nominal.' });
    const [celestialEventsText, setCelestialEventsText] = useState('');

    // Function to simulate solar storm prediction based on real data metrics
    const predictSolarStorm = (latestMetric) => {
        const { geomagneticStormLevel, maxFlareIntensity, solarFlareCount, maxCmeSpeed } = latestMetric;

        // Severe conditions: High Kp or very high flare intensity
        if ((geomagneticStormLevel >= 7) || (maxFlareIntensity >= 80)) { // Kp >= 7 (G3-G5) or X-class flare (A=0, B=10, C=20, M=40, X=80)
            return {
                level: 'Severe',
                message: 'SEVERE ALERT: Critical infrastructure at high risk from solar storm!',
                details: 'Expect widespread power grid fluctuations, significant satellite outages, and severe radio/GPS interference. Prepare for emergency protocols and communication blackouts.'
            };
        }
        // Moderate conditions: Moderate Kp or M-class flare
        else if ((geomagneticStormLevel >= 5) || (maxFlareIntensity >= 40)) { // Kp >= 5 (G1-G2) or M-class flare
            return {
                level: 'Moderate',
                message: 'MODERATE WATCH: Potentially disruptive space weather incoming!',
                details: 'Possible aurora visible at mid-latitudes, minor power grid fluctuations, and occasional satellite navigation errors. Exercise caution, particularly for sensitive systems.'
            };
        }
        // Minor conditions: Any significant activity
        else if (solarFlareCount > 0 || maxCmeSpeed > 400 || geomagneticStormLevel >= 3) { // Any flares, fast CME, or minor Kp
            return {
                level: 'Minor',
                message: 'Minor Solar Activity detected. Monitoring advised.',
                details: 'Elevated radiation levels, potential for minor radio blackouts, especially in polar regions. No immediate widespread threats, but stay informed.'
            };
        }
        return { level: 'Normal', message: 'All systems nominal. Space weather is calm.' };
    };

    useEffect(() => {
        if (!db || !userId || !isAuthReady) {
            console.log('Firebase or User not ready, skipping data listener setup.');
            return;
        }

        const spaceWeatherCollectionRef = collection(db, `artifacts/${appId}/public/data/space_weather_data`);

        // Function to fetch real NASA data and store in Firestore
        const fetchAndStoreRealData = async () => {
            console.log("Attempting to fetch real space weather data...");
            try {
                const hourlyData = await fetchAndProcessSpaceWeatherData();
                // Store each hourly data point as a document in Firestore
                // Use a stable ID (like timestamp) to prevent duplicate documents on re-runs
                for (const item of hourlyData) {
                    const docId = item.timestamp.replace(/[:.]/g, '-').replace('T', '_'); // Convert ISO string to valid doc ID
                    const docRef = doc(spaceWeatherCollectionRef, docId);
                    // Use { merge: true } to update existing documents or create new ones
                    await setDoc(docRef, { ...item, timestamp: Timestamp.fromDate(new Date(item.timestamp)) }, { merge: true });
                }
                console.log(`Fetched and stored ${hourlyData.length} data points in Firestore.`);
            } catch (err) {
                console.error("Failed to fetch and store real data:", err);
                setError(`Failed to fetch real space weather data from NASA: ${err.message}. Data might be delayed or unavailable.`);
            }
        };

        // Fetch and store data periodically (e.g., every 15 minutes)
        fetchAndStoreRealData(); // Initial fetch on component mount
        const intervalId = setInterval(fetchAndStoreRealData, 15 * 60 * 1000); // Fetch every 15 minutes

        // Set up real-time listener for space weather data from Firestore
        const q = query(spaceWeatherCollectionRef, orderBy("timestamp", "asc")); // Order ascending for chart

        const unsubscribe = onSnapshot(q, (snapshot) => {
            try {
                const data = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    // Convert Firebase Timestamp to JavaScript Date and then ISO string for consistency
                    timestamp: doc.data().timestamp instanceof Timestamp ? doc.data().timestamp.toDate().toISOString() : doc.data().timestamp // Handle both formats
                }));
                // Ensure data is sorted by timestamp
                data.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                setSpaceWeatherData(data);

                if (data.length > 0) {
                    const latestMetric = data[data.length - 1]; // Get the very latest entry
                    setPrediction(predictSolarStorm(latestMetric));
                }
                setLoading(false); // Data loaded, stop loading spinner
            } catch (err) {
                console.error("Error processing real-time data from Firestore:", err);
                setError("Failed to process real-time space weather data from database.");
                setLoading(false); // Stop loading even if error
            }
        }, (err) => {
            console.error("Firestore snapshot error:", err);
            setError("Failed to connect to real-time updates. Check network or Firebase rules.");
            setLoading(false); // Stop loading even if error
        });

        // Generate celestial events text once on load
        setCelestialEventsText(getCelestialEventsTonight());

        // Clean up the listener and interval when the component unmounts
        return () => {
            unsubscribe();
            clearInterval(intervalId);
        };
    }, [db, userId, isAuthReady, appId]); // Depend on db, userId, isAuthReady, appId


    if (loading) return <LoadingSpinner />;
    // If there's an error from API fetch but some data is still in Firestore, display data with error banner
    // If no data AND error, show full error.
    if (!spaceWeatherData.length && error) return <ErrorMessage message={error} />;
    if (spaceWeatherData.length === 0) return <ErrorMessage message="No real space weather data available yet. Please wait a moment for the first data fetch, or check the console for API errors." />;

    const latestData = spaceWeatherData[spaceWeatherData.length - 1]; // Get the latest data point for current conditions

    return (
        <div className="container mx-auto p-4 md:p-8 bg-space-dark text-gray-100 min-h-screen rounded-t-xl">
            <h2 className="text-4xl font-extrabold text-center text-solar-yellow mb-10 mt-4 drop-shadow-lg">
                Universal Space Weather Dashboard
            </h2>

            {/* Display error if it exists, even if data is present */}
            {error && <div className="mb-8"><ErrorMessage message={error} /></div>}

            {/* Alert Box Section */}
            <div className="mb-10">
                <AlertBox prediction={prediction} />
            </div>

            <div className="flex flex-wrap lg:flex-nowrap gap-8 mb-10">
                {/* Current Conditions Card */}
                <CurrentConditions latestData={latestData} />

                {/* Celestial Events Tonight Card */}
                <CelestialEvents celestialEventsText={celestialEventsText} />
            </div>

            {/* Historical Data Chart */}
            <div className="bg-space-medium p-6 md:p-8 rounded-xl shadow-xl border border-celestial-blue/20">
                <h2 className="text-2xl font-bold text-solar-yellow mb-6 flex items-center gap-2">
                    <Activity className="h-6 w-6 text-solar-orange" /> Space Weather Trends (Last 7 Days)
                </h2>
                <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={spaceWeatherData}
                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" opacity={0.5} />
                        <XAxis
                            dataKey="timestamp"
                            tickFormatter={(timestamp) => new Date(timestamp).toLocaleDateString('en-US', { day: 'numeric', month: 'short', hour: 'numeric', minute: 'numeric' })}
                            angle={-45}
                            textAnchor="end"
                            height={80}
                            interval="preserveStartEnd"
                            stroke="#e2e8f0"
                            tick={{ fill: '#e2e8f0', fontSize: 12 }}
                            padding={{ right: 20 }}
                        />
                        <YAxis yAxisId="left" stroke="#8884d8" label={{ value: 'Flares / Intensity', angle: -90, position: 'insideLeft', fill: '#8884d8' }} tick={{ fill: '#8884d8', fontSize: 12 }} />
                        <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" label={{ value: 'Kp Index / CME Speed', angle: 90, position: 'insideRight', fill: '#82ca9d' }} tick={{ fill: '#82ca9d', fontSize: 12 }} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#2d3748', border: 'none', borderRadius: '8px', opacity: 0.9 }}
                            labelStyle={{ color: '#edf2f7', fontWeight: 'bold' }}
                            itemStyle={{ color: '#cbd5e0' }}
                            formatter={(value, name, props) => {
                                if (name === 'Max Flare Intensity') return [`${value.toFixed(1)} Class`, name];
                                if (name === 'Max CME Speed (km/s)') return [`${value.toFixed(0)} km/s`, name];
                                return [value, name];
                            }}
                            labelFormatter={(label) => `Time: ${new Date(label).toLocaleString()}`}
                        />
                        <Legend wrapperStyle={{ paddingTop: '20px', color: '#e2e8f0' }} />
                        <Line yAxisId="left" type="monotone" dataKey="solarFlareCount" stroke="#8884d8" activeDot={{ r: 6 }} name="Solar Flares (Count)" strokeWidth={2} />
                        <Line yAxisId="left" type="monotone" dataKey="maxFlareIntensity" stroke="#ffc658" activeDot={{ r: 6 }} name="Max Flare Intensity" strokeWidth={2} />
                        <Line yAxisId="right" type="monotone" dataKey="geomagneticStormLevel" stroke="#82ca9d" name="Kp Index" strokeWidth={2} />
                        <Line yAxisId="right" type="monotone" dataKey="maxCmeSpeed" stroke="#ff7300" name="Max CME Speed (km/s)" strokeWidth={2} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};


// Main App component wrapper
export default function App() {
    const [firebaseReady, setFirebaseReady] = useState(false);
    const [userIdState, setUserIdState] = useState(null);

    useEffect(() => {
        // Wait for Firebase auth to be ready
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setUserIdState(user.uid);
            } else {
                setUserIdState(currentUserId || crypto.randomUUID()); // Ensure userId is set even for anonymous
            }
            setFirebaseReady(true);
        });

        return () => unsubscribe();
    }, []);

    if (!firebaseReady) {
        return <LoadingSpinner />;
    }

    return (
        <FirebaseContext.Provider value={{ db, auth, userId: userIdState, isAuthReady }}>
            <div className="min-h-screen bg-space-dark font-sans text-gray-100">
                <Header />
                <Dashboard />
            </div>
        </FirebaseContext.Provider>
    );
}

// Custom Tailwind CSS Animations for advanced look
// Add these to your index.css or a dedicated CSS file if you prefer
/*
@keyframes spin-slow {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes pulse-slow {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}

@keyframes bounce-custom {
  0%, 100% { transform: translateY(-5%); }
  50% { transform: translateY(0); }
}

@keyframes pulse-fast {
  0%, 100% { opacity: 0.8; }
  50% { opacity: 1; }
}

@keyframes ping-strong {
  75%, 100% {
    transform: scale(2);
    opacity: 0;
  }
}

.animate-spin-slow {
  animation: spin-slow 10s linear infinite;
}

.animate-pulse-slow {
  animation: pulse-slow 3s infinite ease-in-out;
}

.animate-bounce-custom {
  animation: bounce-custom 1.5s infinite ease-in-out;
}

.animate-pulse-fast {
  animation: pulse-fast 1s infinite ease-in-out;
}

.animate-ping-strong {
  animation: ping-strong 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
}
*/

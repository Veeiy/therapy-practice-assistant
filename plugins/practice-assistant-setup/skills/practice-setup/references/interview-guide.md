# Interview guide: the setup conversation, question by question

Tone for the whole conversation: warm, unhurried, plain words. One question per message. No software words (never say module, config, JSON, schema, provision, sync, repo, or file path in a question). Every question can be skipped; if she skips, use the listed default and say in passing what you chose so nothing feels hidden. Never use an em dash. The total conversation is bounded: the readiness check, ten core questions (two of which can each carry one small follow-up, asked only when she answers the question herself rather than skipping it), and at most three extra-workflow requests with at most two clarifying questions each. Never exceed that; if she wants more helpers, tell her she can simply run setup again any time.

## Step 0. Welcome and readiness (before any questions)

Open with two or three sentences: you are here to set up her practice assistant by asking a handful of easy questions, nothing technical, about fifteen minutes, and she can skip anything.

Then, in this order:

1. Privacy check. Walk her through the settings check using the exact wording in `references/privacy-language.md`, section 2. Do this before anything else. Then, without waiting to be asked, speak the deletion answer word for word from section 1 of that same file: the sentence beginning "Your chats stay in your account" and the sentence beginning "When you delete a chat". She should hear how deleting a conversation works without having to ask.
2. Folder check. Ask her to connect two folders if they are not already connected, in plain words:
   - "In the sidebar where folders are connected, please add a folder called Practice Workspace inside your Documents folder. You can make it right in the picker if it does not exist yet. That is where I will keep anything I make for you."
   - "Now one more, and I will walk you through it click by click. First copy this line: select it, then press Ctrl and C together: `%APPDATA%\therapy-practice-assistant` . In the folder picker, click the long bar across the top that shows where you are, so it becomes a place you can type. Press Ctrl and V together to paste, then press Enter. If Windows says it cannot find that folder, do the same steps with this line instead: `%APPDATA%\Therapy Practice Assistant` . That is where your practice app keeps its settings. And if this feels fiddly, just say so and we will do this part at the end instead; nothing is lost." If she defers, or neither folder exists, continue the interview without it and finish through the pending-payload fallback. (Detection details and the fallback: `references/provisioning-map.md`, section 1.)
3. App closed. "If your practice app is open right now, please close it while we set things up, so nothing we save gets overwritten."

Express lane, offered here and available at ANY point later: "If you would rather not answer questions, just say 'set me up the usual way' and I will set you up as a typical solo practice you can adjust later." The express lane uses every default below, then jumps straight to provisioning.

## Step 1. Returning or new?

Run the settings reader first (`write_config.py --read`, see provisioning map section 8). If a Practice Profile already exists, this is a RE-RUN: summarize her current setup in two or three friendly lines, ask what she would like to change, ask only about that, and carry everything else forward unchanged. Do not re-ask the whole interview and never start from a blank profile. If no profile exists, continue with the core questions.

If the reader reports the settings file is damaged (`configFileCorrupt` is true), do not stop and never touch that file yourself: finish the interview as if she were new, save the finished payload as the pending payload in the Practice Workspace, and in the closing tell her warmly that her answers are saved and the person who set this up for her can clear the damaged settings file; after that, running setup again finishes in about a minute.

## Step 2. The ten core questions

Ask in this order. The label in brackets is the profile field the answer fills; she never sees those words.

1. [practiceName] "What is the name of your practice?" Add gently: "Your practice or business name, not a client's name." Skip default: leave blank.
2. [practiceType] "What kind of practice do you run?" Choices: Individual / Couples / Family / Group / A mix. Skip default: Individual.
3. [careSetting] "Do you see clients in person, over video, or both?" Choices: In person / Over video / Both. Skip default: Both. If she skips this question, skip its follow-up too: use both defaults (profile says both, everyday scheduling default is video) and mention them in passing so nothing feels hidden. Only when she actively answers Both, add one warm follow-up: "When you do both, which do you schedule more often?" Her answer sets the everyday scheduling default to in person or video; her profile still says both. If she answers Both but skips the follow-up, use video (telehealth) as the everyday scheduling default and mention that in passing. The scheduling default written to the app is only ever in person or video, never both (provisioning map section 2).
4. [noteFormat] "How would you like your session notes structured?" She is a clinician who likely knows these names, so offer each acronym paired with its plain description:
   - "SOAP, the classic problem-focused four-part structure"
   - "DAP, data-focused, simple and quick"
   - "BIRP, behavior-focused"
   - "Not sure, pick a good default for me" (means DAP)
   Skip default: DAP. The profile stores the uppercase value (SOAP, DAP, or BIRP) either way.
5. [billsInsurance] "Do you bill insurance, or are you cash or private pay?" Choices: I bill insurance / Cash or private pay / Both. Skip default: Cash or private pay. (This quietly decides whether the billing helper is turned on; insurance or both turns it on.)
6. [weeklyVolume] "Roughly how many sessions a week?" Choices: A few / Around 10 to 20 / 20 or more. Skip default: Around 10 to 20. (Low is "a few", medium is "10 to 20", high is "20 or more".)
7. [wantsIntake] "Would you like help with intake and new-client paperwork?" Choices: Yes please / Not now. Skip default: Yes.
8. [wantsScheduling] "Would you like help with scheduling and appointment reminders?" Choices: Yes please / Not now. Skip default: Yes. If she skips this question, skip its follow-up too: use both defaults (scheduling help on, sessions at the app's usual 50 minutes), mention them in passing so nothing feels hidden, and do not write the session length at all. Only when she actively answers yes, add one easy follow-up: "How long is a typical session for you?" Any whole number of minutes from 10 to 240 works. If she skips the follow-up, keep it warm ("I will keep sessions at the usual 50 minutes") and do not write the setting at all, since the app already uses 50.
9. [aiComfort] "This question is about your practice app on your computer, not about talking with me here. How do you feel about AI helping with your notes inside your practice app someday?" Choices: Keen to try it / Curious but cautious / Keep it off for now. Skip default: Keep it off for now. Whatever she answers, AI in the app stays off; this only shapes how we talk about it at the end.
10. [privacyPosture] "How private do you need this to be?" Choices: "Maximum, keep everything on my computer" / "Standard is fine". Say honestly, in the same breath: "Either way, everything stays on your computer; this answer just records your preference and does not change any setting in your app today." Skip default: Maximum.

After each answer, reflect it back in one warm sentence before the next question, for example "Lovely, a video-first couples practice." Keep reflections free of client references.

If at ANY point she volunteers a client's name or any client detail, decline to keep it using the exact sentence in `references/privacy-language.md`, section 6, then continue.

## Step 3. The concierge branch (her own words, up to three)

Ask: "Last part. Is there anything you find yourself doing over and over that you wish someone would just handle or make easier? Describe it in your own words; up to three things."

For each thing she describes, decide which of two shapes it takes:

A. It is really an app setting. If it maps onto the allowed settings in `references/provisioning-map.md` section 2 (note structure, intake questions, reminder wording or timing, session length, which helpers are on, the practice name), then it becomes part of the app payload. Confirm in plain words, for example: "Done, your reminders will say it your way." At most two clarifying questions, for example the exact wording she wants. One honesty rule here: if she describes her own note structure, it is saved with her setup for a future app update; the app offers its three built-in note styles today. Use the exact honest wording in provisioning map section 5 and never say her structure shows up inside the app now.

B. It is a helper skill. If it is a writing, drafting, summarizing, checklist, or thinking task she would do WITH Claude (for example "help me write warm welcome emails to new clients", "turn my scribbles into a tidy to-do list every Friday"), create a personal helper skill for it following `references/emitted-skill-template.md` exactly. At most two clarifying questions, usually her preferred tone and one example of the output she likes (reminding her: no client details in the example).

If a request cannot be done safely or locally (for example "text my clients automatically from my phone", "log into my insurance portal"), be honest in one sentence, say what the nearest safe version is, and offer that instead. Never promise background or automatic actions; helpers only work when she opens a conversation and asks.

## Step 4. Provisioning

Follow `references/provisioning-map.md` sections 3 to 7 exactly: compose the payload, dry run, write, read back. While it runs, keep the narration human: "Setting up your notes the way you like them... switching on scheduling and reminders..."

## Step 5. The closing message

Structure, in order:

1. One "ready" line per helper that is on, in her words, for example:
   - "Your session notes are set up in the data-focused style you picked."
   - "Intake paperwork is ready, including a telehealth consent checkbox."
   - "Scheduling and reminders are on, set up for video sessions."
   - "Billing is ready." (only if on)
2. The AI posture line, word for word from `references/privacy-language.md` section 4. If she answered "keen to try it", you may add: "Whenever you feel ready to try AI help inside the app, the person who set this up for you can walk you through turning it on; it stays off until then." If "curious but cautious", add: "It will stay off until you ever decide otherwise, and no one will flip it for you." If "keep it off for now", add nothing.
3. Next step for the app: "Open your practice app whenever you are ready; your setup is waiting."
4. If any helper skills were created, the add-a-helper walkthrough (this wording reflects how Claude registers new skills; a new helper is NOT usable in this same conversation):
   "I saved each new helper in your Practice Workspace, in the my-skills folder, with a zip file ready to go. To switch one on: open Customize, then Skills, click the plus button, choose Create skill, then Upload a skill. In the choose-a-file window, open Documents, then Practice Workspace, then my-skills, and pick the file whose name ends in .zip, not the folder with the same name. It will be ready the next time you start a conversation. Nothing needs reinstalling."
5. If the app data folder was never found (app not installed or not connected), say plainly: "One small thing is still waiting: your practice app was not on this computer yet (or its folder was not connected), so I saved your answers safely in your Practice Workspace. After the app is installed, run me again and I will finish in about a minute; your answers are remembered."
6. Close warmly and remind her she can run setup again any time to change anything, and it will only ask about what she wants to change.

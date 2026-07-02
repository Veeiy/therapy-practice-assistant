# Privacy language (single source of truth)

Every privacy, retention, or AI-posture sentence shown to the user, and every guardrail line placed in an emitted skill, MUST be copied from this file word for word. Do not paraphrase, shorten, or improvise privacy language anywhere else in this plugin or in anything it generates.

Verified against Anthropic's primary consumer data retention article on 2026-07-01:
https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data
Toggle click path verified the same day against:
https://privacy.claude.com/en/articles/12109829-how-do-i-change-my-model-improvement-privacy-settings

## 1. The harmonized retention formulation (the only retention wording allowed)

> What you share with Claude here is processed and stored by Anthropic under your own Claude plan. Your chats stay in your account until you delete them. When you delete a chat, it disappears from your chat history right away and is removed from Anthropic's storage systems within 30 days. If your privacy settings allow your chats to be used to improve Claude, chats can be kept in de-identified form for up to 5 years, which is why we check that setting is off before we begin. Chats flagged by Anthropic's automated safety systems can be kept longer.

When space is tight, this one-sentence short form is the only permitted abbreviation:

> Conversations with Claude are processed and stored by Anthropic under your own Claude plan, so keep client details out of them.

## 2. The privacy settings walk-through (early interview step, word for word)

> Before we start, let's take twenty seconds to check one setting together, so your conversations are not used to train the AI.
>
> 1. Click your name or initials in the corner of Claude, then choose Settings.
> 2. Click Privacy.
> 3. Find the switch called "Help Improve Claude".
> 4. If it is on, turn it off.
>
> Tell me when it shows off, or if you cannot find it, and we will sort it out together. If you prefer, you can also open claude.ai/settings/data-privacy-controls in your browser to reach the same switch.

If the user says the switch is already off, acknowledge briefly and move on. If the user cannot find it or wants to leave it on, do not argue; explain once, in one sentence, using the harmonized formulation above, and note her choice in the closing summary so she can revisit it.

## 3. The two guardrail lines for every emitted skill (word for word, always the first two rules)

> 1. Never include client names, initials, contact details, birth dates, diagnoses, or any other detail that could identify a client in this conversation. If one appears, pause and ask for it to be replaced with a neutral placeholder such as "the client" before continuing.
> 2. Privacy note: everything shared in this conversation is processed and stored by Anthropic under your own Claude plan, so it must stay free of client details.

## 4. The AI posture line for the practice app (closing message)

> Inside your practice app on your computer, AI help stays off until you choose to turn it on. Setting things up today does not switch it on, and nothing in your practice app is sent anywhere by this setup.

## 5. The honest compliance posture

Never write "HIPAA compliant" about the practice app, this plugin, Claude, or any part of the setup, in any phrasing. The only permitted posture sentence, if the topic comes up, is:

> This assistant is built to support the way you meet your professional privacy obligations. It is not a compliance guarantee, and you stay in charge of what goes where.

## 6. Declining volunteered client details during setup (one friendly sentence, word for word)

> I want to keep every client detail out of our conversation and out of your setup files, so let's leave that out; you can tell me about your practice without naming anyone.

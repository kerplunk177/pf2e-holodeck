# PF2e Holodeck & Combat Forensics

A comprehensive analytics module for Foundry VTT that brings combat tracking and encounter simulations to your Pathfinder/Starfinder 2e campaigns.

##  Combat Forensics Engine (The Parser)
The core parser silently wiretaps the Foundry chat log and combat tracker, breaking down complex PF2e mechanics into precise, actionable data.

* **Deep Mechanics Scraping:** Automatically captures and logs attacks, saves, skill checks, damage applications, mitigations, and healing.
* **Summon Attribution:** Intelligently attributes damage and actions from familiars, animal companions, and summons directly to their master's ledger. Uses fuzzy string matching and trait detection to flawlessly trace minion lineage.
* **Timeline Generation:** Rebuilds every combat round into a highly readable, color-coded timeline UI, explicitly tagging minion actions so credit is clear (e.g., `Melee Strike [Skeleton Guard]`).
* **Exploration & Sim Modes (The Holodeck):** Seamlessly separates live campaign combat data from background narrative exploration and GM test simulations.
* **Persistent Archiving:** Saves historical combat data to the world settings and can export full statistical reports directly into Foundry Journal Entries for long-term storage.

##  Pit Boss Insights (GM Only Analytics)
A classified, GM-only dashboard that exposes the statistical reality of your encounters.

* **Advanced Variance Math:** Recursively cracks open PF2e's complex nested dice objects to calculate exactly what a combatant *should* have rolled versus what they *actually* rolled, generating a precise Damage Skew percentage for both the party and the enemies.
* **Fate & Probability Tracking:** Identifies the luckiest and unluckiest rollers at the table based on pure d20 averages.
* **Elemental Footprint:** Generates an interactive pie chart breaking down the exact damage types (Fire, Slashing, Mental, etc.) utilized by the enemy forces.
* **Efficiency Metrics:** Compares the average real-world time taken per PC turn versus the average time taken per Enemy turn.
* **Dynamic Threat Scaling:** Analyzes the active combatants and calculates the exact XP budget and threat level (Trivial to Extreme) on the fly.

  This module began as a way for the GM to test combats in PF2e and SF2e. The reality is that no matter how meticulous the balance is from Paizo's perspective, each homebrew element and unique situation dynamically change the balance of encounters, rendering the xp-difficulty chart a suggestion more than an accurate rubric. To solve this, GMs can now activate simulation mode. In this mode, the GM can create save states, easily loading between different saves.
  To accomplish this, the module takes the current scene, copies all of the PCs and NPCs, severs the "Link to actor" setting on the tokens, and allows the GM to poke and prod on the combat to their heart's content. The simulation contains an aggressive red text and blinking outline that reminds you that you're in simulation, so that you never accidentally conduct a combat in sim, then swap scenes only to find that your players are undamaged, and have all their ammo and spells. Included in the Holodeck dialogue is a "Commit NPC Changes" which will push NPC changes that are made throughout the course of a simulation to previous saves and to the main. So, if you have to change the AC of an NPC, you can make those changes stick!

   The parser contains just about every insight that I could think to include. It has three different tabs for displaying information: The Overview, the Timeline, and the Combatants tab. A dropdown helps you swap between individual combat or exploration settings, or a meta perspective that includes an aggregation of all available parser data. It is worth noting that Sim data from the holodeck is strictly cordoned such that players cannot access it, and it won't affect the meta data for any given category, allowing GMs to endlessly test without skewing the player data.
   
   While this contains very useful insights about combat and variant data, the main purpose is for players to be able to get a better understanding of how the combat shook up and what things went well and what didn't. While it isn't my place to say how a tool is used, I would urge players to not use this data like aggressive MMO players to insult others at the table.

  <img width="480" height="465" alt="image" src="https://github.com/user-attachments/assets/8c61c970-c92a-42b8-a581-861490864ae1" />

  <img width="1738" height="1534" alt="image" src="https://github.com/user-attachments/assets/eae6d8a6-1ef9-4904-a11b-4deaf5028711" />

  <img width="1744" height="1543" alt="image" src="https://github.com/user-attachments/assets/a51d62ec-fa94-407a-ba52-2b7de7e3d20d" />

  <img width="1744" height="1530" alt="image" src="https://github.com/user-attachments/assets/d4ac18d6-d7ca-4288-8da1-0f470c01e99f" />




// Each node is either a text node or a choice node.
//
//   Text node:   { text: "...", next: 'node_key' }   (next: null to end)
//   Choice node: { choices: [ { label: "...", next: 'node_key' }, ... ] }
//
// Branches converge by pointing different nodes' `next` to the same key.

export const FATES_DIALOGUE = {
    start: 'n1',
    nodes: {
        // --- THE AWAKENING ---
        n1:  { text: "...",                                                          next: 'n2'  },
        n2:  { text: "...",                                                          next: 'n3'  },
        n3:  { text: "...?",                                                         next: 'n4'  },
        n4:  { text: "...!",                                                         next: 'n5'  },
        n5:  { text: "Is someone actually there?!",                                  next: 'n6'  },
        n6:  { text: "Oh. It's just you.",                                           next: 'n7'  },
        n7:  { text: "It's been a long time since anyone dropped down here.",         next: 'n8'  },
        n8:  { text: "Welcome to the Fates.",                                        next: 'n9'  },
        n9:  { text: "We used to keep track of everyone. Make sure you went where you belonged.", next: 'n10' },
        n10: { text: "Well...",                                                      next: 'n11' },
        n11: { text: "It used to be 'us.' Now it's just me.",                        next: 'n12' },
        n12: { text: "The others are gone.",                                         next: 'n13' },
        n13: { text: "Something pulled them into the dark.",                         next: 'n14' },
        n14: { text: "Something that came down from the world above.",               next: 'n15' },
        n15: { text: "I tried to stop it.",                                          next: 'n16' },
        n16: { text: "I really did. But it didn't even notice me.",                  next: 'n17' },
        n17: { text: "It just took them. One by one.",                               next: 'n18' },
        n18: { text: "I think it only left me because I was too quiet to find.",     next: 'n19' },
        n19: { text: "...",                                                          next: 'n20' },
        n20: { text: "...",                                                          next: 'n21' },
        
        // --- THE JUMP SCARE REACTION ---
        n21: { 
            text: "ENOUGH OF THAT!", 
            slam: true, 
            style: { fontSize: '5.5rem', color: '#ff2020' }, 
            shake: 0.09, 
            bg: 'red', 
            next: 'n22' 
        },
        
        // --- CRITICAL RE-ANCHORING & TONAL RESET ---
        n22: { text: "When you people die, you usually just break apart.",           bg: 'default', next: 'n23' },
        n23: { text: "...",                                                          next: 'n24' },
        n24: { text: "Why are you still holding together?",                          next: 'n25' },
        n25: { text: "You're still breathing, aren't you?",                          next: 'n26' },
        n26: { text: "That shouldn't be possible.",                                  next: 'n27' },
        n27: { text: "...",                                                          next: 'n28' },
        n28: { text: "Never mind. Forget I asked.",                                  next: 'n29' },
        n29: { text: "...",                                                          next: 'n30' },
        n30: { text: "They say this place is just a broken reflection of your world.", next: 'n31' },
        n31: { text: "...",                                                          next: 'n32' },
        n32: { text: "At least, that's what the others told me.",                    next: 'n33' },
        n33: { text: "I don't really remember what the sky looks like anymore.",     next: 'n34' },
        n34: { text: "...",                                                          next: 'q1'  },

        // --- QUESTION INTERFACE MAIN NODE ---
        q1: { 
            bg: 'white', 
            choices: [
                { label: "What was the beast?",    next: 'a_beast', id: 'beast' },
                { label: "Can I get out of here?", next: 'a_back',  id: 'back'  },
                { label: "...",                    next: 'a_quiet', id: 'quiet' },
            ]
        },

        // --- INTERMEDIARY RE-LOOP DIALOGUE ---
        anything_else: { text: "Anything else?", next: 'q_loop' },

        q_loop: {
            bg: 'white',
            choices: [
                { label: "What was the beast?",    next: 'a_beast', id: 'beast' },
                { label: "Can I get out of here?", next: 'a_back',  id: 'back'  },
                { label: "...",                    next: 'a_quiet', id: 'quiet' },
            ]
        },

        // --- BRANCH 1: THE BEAST LORE ---
        a_beast:  { text: "I don't know. It left when the room went empty.",                    bg: 'default', next: 'b2' },
        b2:       { text: "But sometimes, when the engine settles...",                          next: 'b3' },
        b3:       { text: "I can still hear it walking out there in the fog.",                  next: 'b4' },
        b4:       { text: "If you look up and see something staring back down through the clouds...", next: 'b5' },
        b5:       { text: "...just stop moving. Don't breathe.",                                next: 'check_remaining' },

        // --- BRANCH 2: RETURNING TO SURFACE ---
        a_back:   { text: "Get out? Back to the surface? People try.",                          bg: 'default', next: 'k2' },
        k2:       { text: "But your physical shell up there is completely broken.",             next: 'k3' },
        k3:       { text: "Even if you forced your way back up...",                             next: 'k4' },
        k4:       { text: "You can't wash this place off your skin. The cold sticks to you.",   next: 'k5' },
        k5:       { text: "But go ahead. Try to run. See how far you get.",                     next: 'check_remaining' },

        // --- BRANCH 3: SILENCE ---
        a_quiet:  { text: "Nothing to say? Fine by me.",                                        bg: 'default', next: 's2' },
        s2:       { text: "Words don't mean much down here anyway.",                            next: 's3' },
        s3:       { text: "They just sort of dissolve into the air.",                           next: 's4' },
        s4:       { text: "But I can see it in your eyes.",                                     next: 's5' },
        s5:       { text: "You aren't ready to lay down in the dirt just yet.",                 next: 'check_remaining' },

        // --- CONVERGENCE LOOP ---
        converge: { text: "Either way, you shouldn't stand around here.",                       next: 'c2' },
        c2:       { text: "The air is rotting out. The shadows are starting to wander.",        next: 'c3' },
        c3:       { text: "I have work to do. Go away.",                                        next: 'c4' },
        c4:       { text: "You won't last long out there anyway. Grab whatever isn't nailed down.", next: null }
    }
};

export const FATES_DIALOGUE_RETURN = {
    start: 'r1',
    nodes: {
        // --- RECOGNITION ---
        r1:  { text: "Oh.",                                                              next: 'r2'  },
        r2:  { text: "You again.",                                                       next: 'r3'  },
        r3:  { text: "I wasn't expecting that.",                                         next: 'r4'  },
        r4:  { text: "Most people only fall through once.",                              next: 'r5'  },
        r5:  { text: "...",                                                              next: 'r6'  },
        r6:  { text: "The world above must be getting rougher.",                         next: 'r7'  },
        r7:  { text: "...",                                                              next: 'rq1' },

        // --- CHOICE SECTION 1 ---
        rq1: {
            bg: 'white',
            choices: [
                { label: "Something's been following me.",  next: 'ra1' },
                { label: "This place looks different.",     next: 'rb1' },
                { label: "Just passing through.",          next: 'rc1' },
            ]
        },

        // --- BRANCH A: SOMETHING FOLLOWING ---
        ra1: { text: "Following you.",                                                   bg: 'default', next: 'ra2' },
        ra2: { text: "...",                                                              next: 'ra3' },
        ra3: { text: "Yes. I've noticed something moving in the outer fog lately.",      next: 'ra4' },
        ra4: { text: "It circles the edges. Never comes in.",                            next: 'ra5' },
        ra5: { text: "I don't know if it's the same thing you're thinking of.",          next: 'ra6' },
        ra6: { text: "But I'd stop leaving tracks if I were you.",                       next: 'rmid' },

        // --- BRANCH B: PLACE LOOKS DIFFERENT ---
        rb1: { text: "Different how?",                                                   bg: 'default', next: 'rb2' },
        rb2: { text: "...",                                                              next: 'rb3' },
        rb3: { text: "It shifts sometimes. Rearranges itself when no one is watching.",  next: 'rb4' },
        rb4: { text: "I've stopped trying to map it.",                                   next: 'rb5' },
        rb5: { text: "If you're looking for landmarks, find a rock and name it yourself.", next: 'rmid' },

        // --- BRANCH C: PASSING THROUGH ---
        rc1: { text: "You say that like it's an option.",                                bg: 'default', next: 'rc2' },
        rc2: { text: "The way out doesn't just sit there waiting.",                      next: 'rc3' },
        rc3: { text: "You have to push through. It resists.",                            next: 'rc4' },
        rc4: { text: "Most people figure that out too late.",                            next: 'rmid' },

        // --- BRIDGE TO CHOICE 2 ---
        rmid: { text: "...",                                                             next: 'rmid2' },
        rmid2: { text: "You're still standing here.",                                    next: 'rq2' },

        // --- CHOICE SECTION 2 ---
        rq2: {
            bg: 'white',
            choices: [
                { label: "What are you working on?",  next: 'rd1' },
                { label: "Do you ever leave?",         next: 're1' },
                { label: "That's all I needed.",       next: 'rf1' },
            ]
        },

        // --- BRANCH D: WHAT ARE YOU WORKING ON ---
        rd1: { text: "Sorting threads.",                                                 bg: 'default', next: 'rd2' },
        rd2: { text: "Everyone who dies leaves one behind.",                             next: 'rd3' },
        rd3: { text: "I pull them apart, figure out where they were supposed to go.",    next: 'rd4' },
        rd4: { text: "Most of them are simple. Yours is...",                             next: 'rd5' },
        rd5: { text: "...",                                                              next: 'rd6' },
        rd6: { text: "Knotted.",                                                         next: 'rd7' },
        rd7: { text: "I'll get to it eventually.",                                       next: 'rend' },

        // --- BRANCH E: DO YOU EVER LEAVE ---
        re1: { text: "Leave.",                                                           bg: 'default', next: 're2' },
        re2: { text: "...",                                                              next: 're3' },
        re3: { text: "No.",                                                              next: 're4' },
        re4: { text: "Someone has to stay.",                                             next: 're5' },
        re5: { text: "If I left, the threads would pile up. It would get very loud.",    next: 're6' },
        re6: { text: "...",                                                              next: 're7' },
        re7: { text: "I don't like loud.",                                               next: 'rend' },

        // --- BRANCH F: GOODBYE ---
        rf1: { text: "Fine.",                                                            bg: 'default', next: 'rf2' },
        rf2: { text: "Don't get pulled under.",                                          next: null  },

        // --- BRIDGE TO CHOICE 3 ---
        rend: { text: "...",                                                             next: 'rend2' },
        rend2: { text: "You're still not moving.",                                       next: 'rq3'  },

        // --- CHOICE SECTION 3 ---
        rq3: {
            bg: 'white',
            choices: [
                { label: "Where is this place?",      next: 'rg1' },
                { label: "How long have you been here?", next: 'rh1' },
                { label: "I should go.",               next: 'ri1' },
            ]
        },

        // --- BRANCH G: WHERE IS THIS PLACE ---
        rg1: { text: "Somewhere you can't reach by walking.",                            bg: 'default', next: 'rg2' },
        rg2: { text: "It exists alongside your world. Not above it, not below it.",      next: 'rg3' },
        rg3: { text: "A different layer. A different fabric entirely.",                  next: 'rg4' },
        rg4: { text: "You could dig down forever up there and never break through.",     next: 'rg5' },
        rg5: { text: "You could sail to the edge of every ocean and find nothing.",      next: 'rg6' },
        rg6: { text: "This place doesn't sit at the end of any road.",                   next: 'rg7' },
        rg7: { text: "The only way in is to stop being in yours.",                       next: 'rg8' },
        rg8: { text: "...",                                                              next: 'rg9' },
        rg9: { text: "Which is why I find it strange that you keep ending up here.",     next: 'rfin' },

        // --- BRANCH H: HOW LONG HAVE YOU BEEN HERE ---
        rh1: { text: "I don't know.",                                                    bg: 'default', next: 'rh2' },
        rh2: { text: "Time doesn't stack up properly down here.",                        next: 'rh3' },
        rh3: { text: "I can tell you I was here before your world had cities.",          next: 'rh4' },
        rh4: { text: "Before it had names for things.",                                  next: 'rh5' },
        rh5: { text: "...",                                                              next: 'rh6' },
        rh6: { text: "That's about as precise as I can get.",                            next: 'rfin' },

        // --- BRANCH I: I SHOULD GO ---
        ri1: { text: "Then go.",                                                         bg: 'default', next: 'ri2' },
        ri2: { text: "You know the way.",                                                next: null   },

        // --- FINAL ENDING ---
        rfin: { text: "Anyway.",                                                         next: 'rfin2' },
        rfin2: { text: "The fog is getting thick. You should move.",                     next: 'rfin3' },
        rfin3: { text: "Don't come back too soon.",                                      next: null   },
    }
};
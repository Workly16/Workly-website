// ----------------- EVENT LISTENERS -----------------
document.addEventListener('DOMContentLoaded', () => {
    const chatsBtn = document.getElementById('ChatsBtn');
    if (chatsBtn) chatsBtn.addEventListener('click', openWorkerChat);

    const myJobsBtn = document.getElementById('myJobsBtn');
    if (myJobsBtn) myJobsBtn.addEventListener('click', openOwnerChat);
    
    const closeChatBtn = document.getElementById('closeChatBtn');
    if (closeChatBtn) closeChatBtn.addEventListener('click', closeFloatingChat);

    const backToAllChatsBtn = document.getElementById('backToAllChatsBtn');
    if (backToAllChatsBtn) backToAllChatsBtn.addEventListener('click', goBackToChatList);
});

// ----------------- INPUT SANITIZATION -----------------
function sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[<>&"]/g, char => ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;'
    })[char]);
}

// ----------------- POST JOB -----------------
const jobForm = document.getElementById('jobForm');
const formMessage = document.getElementById('form-message');
const jobsContainer = document.getElementById('jobsContainer');

if (jobForm) {
    jobForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const user = firebase.auth().currentUser;
        if (!user) return alert('Please login first.');

        const jobData = {
            title: sanitizeInput(document.getElementById('title').value),
            location: sanitizeInput(document.getElementById('location').value),
            budget: sanitizeInput(document.getElementById('budget').value),
            description: sanitizeInput(document.getElementById('description').value),
            status: 'open',
            ownerId: user.uid,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            deleted: false
        };

        formMessage.textContent = 'Submitting...';
        firebase.firestore().collection('Jobs').add(jobData)
            .then(() => {
                formMessage.textContent = '✅ Form Submitted. Job is live!';
                jobForm.reset();
            })
            .catch(error => {
                console.error('Error adding job:', error);
                formMessage.textContent = '❌ Something went wrong.';
            });
    });
}

// ----------------- DISPLAY JOBS -----------------
firebase.auth().onAuthStateChanged(user => {
    if (!user) return;

    firebase.firestore().collection('Jobs')
        .orderBy('timestamp', 'desc')
        .onSnapshot(snapshot => {
            if (!jobsContainer) return;
            jobsContainer.innerHTML = '';
            let jobCount = 0;
            snapshot.forEach(doc => {
                const job = doc.data();
                if (job.deleted === true) return;
                jobCount++;
                const isOwner = user.uid === job.ownerId;

                const jobListing = document.createElement('div');
                jobListing.className = 'job-listing';
                jobListing.innerHTML = `
                    <h4>${sanitizeInput(job.title)}</h4>
                    <p><strong>Location:</strong> ${sanitizeInput(job.location)}</p>
                    <p><strong>Budget:</strong> ${sanitizeInput(job.budget)}</p>
                    <p><strong>Description:</strong> ${sanitizeInput(job.description)}</p>
                    ${!isOwner ? `<button class="action-btn secondary" onclick="startPrivateChat('${doc.id}', '${sanitizeInput(job.title).replace(/'/g, "\\'")}')">Private Chat</button>` : ''}
                `;
                jobsContainer.appendChild(jobListing);
            });
            if (jobCount === 0) {
                jobsContainer.innerHTML = '<p>No jobs available at the moment.</p>';
            }
        }, error => {
            console.error('Error fetching jobs:', error);
            if (jobsContainer) jobsContainer.innerHTML = `<p>Error loading jobs: ${error.message}</p>`;
        });
});


// ----------------- DELETE JOB -----------------
function deleteJob(jobId) {
    if (!confirm('Are you sure you want to delete this job and all its related chats? This action cannot be undone.')) {
        return;
    }

    const jobRef = firebase.firestore().collection('Jobs').doc(jobId);

    // First, update the job itself. This is the primary action.
    jobRef.update({ deleted: true })
        .then(() => {
            // --- IMMEDIATE SUCCESS ---
            // The job is successfully marked as deleted. Refresh the UI now.
            console.log('Job marked as deleted:', jobId);
            showAllOwnerJobs(); // This immediately removes the job from the user's view.

            // --- SECONDARY ACTION ---
            // Now, handle the chats in the background. Errors here won't show a failure message to the user.
            const chatsQuery = firebase.firestore().collection('Chats').where('jobId', '==', jobId);
            
            chatsQuery.get().then(snapshot => {
                if (snapshot.empty) {
                    return; // No associated chats to delete.
                }

                const batch = firebase.firestore().batch();
                snapshot.forEach(doc => {
                    batch.update(doc.ref, { deleted: true });
                });
                return batch.commit();

            }).then(() => {
                console.log('Associated chats were also marked as deleted.');
            }).catch(error => {
                // This catch only handles the chat deletion.
                // It logs the error for you (the developer) but doesn't alert the user.
                console.error('A non-critical error occurred while deleting associated chats:', error);
            });
        })
        .catch(error => {
            // This main catch block will now only run if deleting the JOB itself fails.
            console.error('Error deleting job:', error);
            alert('Failed to delete job. Please try again.');
        });
}

// ----------------- PRIVATE CHAT -----------------
let activeChatId = null;
let unsubscribeChat = null;

function startPrivateChat(jobId, jobTitle) {
    const user = firebase.auth().currentUser;
    if (!user) return alert('Please login to start a chat.');

    firebase.firestore().collection('Jobs').doc(jobId).get().then(docSnap => {
        if (!docSnap.exists || docSnap.data().deleted) {
            return alert('This job is no longer available.');
        }
        const job = docSnap.data();
        const chatsRef = firebase.firestore().collection('Chats');
        chatsRef.where('ownerId', '==', job.ownerId)
            .where('workerId', '==', user.uid)
            .where('jobId', '==', jobId)
            .get()
            .then(snapshot => {
                if (!snapshot.empty) {
                    const chatDoc = snapshot.docs[0];
                    if (chatDoc.data().deleted) return alert('This chat is no longer active.');
                    activeChatId = chatDoc.id;
                    openFloatingChat(activeChatId, jobTitle);
                } else {
                    chatsRef.add({
                        ownerId: job.ownerId,
                        workerId: user.uid,
                        jobId,
                        jobTitle: sanitizeInput(jobTitle),
                        messages: [],
                        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                        deleted: false
                    }).then(docRef => {
                        activeChatId = docRef.id;
                        openFloatingChat(activeChatId, jobTitle);
                    });
                }
            });
    });
}

// ----------------- FLOATING CHAT WINDOW -----------------
function openWorkerChat() {
    document.getElementById('floatingChatWindow').style.display = 'flex';
    showAllWorkerChats();
}

function openOwnerChat() {
    document.getElementById('floatingChatWindow').style.display = 'flex';
    showAllOwnerJobs();
}

function closeFloatingChat() {
    document.getElementById('floatingChatWindow').style.display = 'none';
    if (unsubscribeChat) unsubscribeChat();
}

// --- Helper function to get user names reliably ---
async function getParticipantNames(chatDocs, currentUserId) {
    const names = {};
    const userIdsToFetch = new Set();

    chatDocs.forEach(doc => {
        const chat = doc.data();
        const partnerId = chat.ownerId === currentUserId ? chat.workerId : chat.ownerId;
        if (partnerId) userIdsToFetch.add(partnerId);
    });

    if (userIdsToFetch.size === 0) return names;

    const userDocs = await Promise.all(
        Array.from(userIdsToFetch).map(id => firebase.firestore().collection('Users').doc(id).get())
    );
    const fetchedNames = {};
    userDocs.forEach(doc => {
        if (doc.exists && doc.data().displayName) {
            fetchedNames[doc.id] = sanitizeInput(doc.data().displayName);
        } else {
            fetchedNames[doc.id] = "Unknown User";
        }
    });

    chatDocs.forEach(doc => {
        const chat = doc.data();
        const partnerId = chat.ownerId === currentUserId ? chat.workerId : chat.ownerId;
        names[doc.id] = fetchedNames[partnerId] || "Chat Partner";
    });

    return names;
}

// --- Functions to show chat lists ---
async function showAllWorkerChats() {
    const user = firebase.auth().currentUser;
    if (!user) return;

    const content = document.getElementById('floatingChatContent');
    document.getElementById('floatingChatInput').style.display = 'none';
    document.getElementById('floatingSendBtn').style.display = 'none';
    content.innerHTML = '<p>Loading your chats...</p>';

    try {
        const chatsRef = firebase.firestore().collection('Chats');
        const [workerSnapshot, ownerSnapshot] = await Promise.all([
            chatsRef.where('workerId', '==', user.uid).where('deleted', '==', false).get(),
            chatsRef.where('ownerId', '==', user.uid).where('deleted', '==', false).get()
        ]);

        const allChatDocs = [...workerSnapshot.docs, ...ownerSnapshot.docs];
        const participantNames = await getParticipantNames(allChatDocs, user.uid);

        let html = '';
        allChatDocs.forEach(doc => {
            const chat = doc.data();
            const displayName = participantNames[doc.id] || "Chat Partner";
            html += `<p style="cursor:pointer;" onclick="openFloatingChat('${doc.id}', 'About: ${sanitizeInput(chat.jobTitle).replace(/'/g, "\\'")}')">
                        Chat with <strong>${sanitizeInput(displayName)}</strong> about "${sanitizeInput(chat.jobTitle)}"
                     </p>`;
        });

        content.innerHTML = allChatDocs.length > 0 ? html : '<p>No chats yet.</p>';
        document.getElementById('floatingChatTitle').textContent = 'Your Chats';
    } catch (error) {
        console.error('Error fetching chats:', error);
        content.innerHTML = `<p>Error loading chats.</p>`;
    }
}

async function showAllOwnerJobs() {
    const user = firebase.auth().currentUser;
    if (!user) return;

    const content = document.getElementById('floatingChatContent');
    document.getElementById('floatingChatInput').style.display = 'none';
    document.getElementById('floatingSendBtn').style.display = 'none';
    content.innerHTML = '<p>Loading your jobs...</p>';

    try {
        const jobsSnapshot = await firebase.firestore().collection('Jobs').where('ownerId', '==', user.uid).where('deleted', '==', false).get();
        let html = '';
        jobsSnapshot.forEach(doc => {
            const job = doc.data();
            html += `
                <div class="job-listing">
                    <p onclick="showChatsForJob('${doc.id}', '${sanitizeInput(job.title).replace(/'/g, "\\'")}')" style="cursor:pointer; font-weight: 600;">${sanitizeInput(job.title)}</p>
                    <button class="action-btn secondary" style="padding: 5px 10px; font-size: 0.8rem;" onclick="deleteJob('${doc.id}')">Delete</button>
                </div>`;
        });
        content.innerHTML = jobsSnapshot.docs.length > 0 ? html : '<p>No jobs posted yet.</p>';
        document.getElementById('floatingChatTitle').textContent = 'Your Jobs';
    } catch (error) {
        console.error('Error fetching owner jobs:', error);
        content.innerHTML = `<p>Error loading jobs.</p>`;
    }
}

async function showChatsForJob(jobId, jobTitle) {
    const user = firebase.auth().currentUser;
    if (!user) return;
    
    const content = document.getElementById('floatingChatContent');
    document.getElementById('floatingChatInput').style.display = 'none';
    document.getElementById('floatingSendBtn').style.display = 'none';
    content.innerHTML = '<p>Loading chats...</p>';

    try {
        const chatsSnapshot = await firebase.firestore().collection('Chats').where('jobId', '==', jobId).where('ownerId', '==', user.uid).where('deleted', '==', false).get();
        
        const participantNames = await getParticipantNames(chatsSnapshot.docs, user.uid);

        let html = '';
        chatsSnapshot.forEach(doc => {
            const workerName = participantNames[doc.id] || "Applicant";
            html += `<p style="cursor:pointer;" onclick="openFloatingChat('${doc.id}', '${sanitizeInput(doc.data().jobTitle).replace(/'/g, "\\'")}')">
                        Chat with <strong>${sanitizeInput(workerName)}</strong>
                     </p>`;
        });

        content.innerHTML = chatsSnapshot.docs.length > 0 ? html : `<p>No chats for this job yet.</p>`;
        document.getElementById('floatingChatTitle').textContent = `Chats for: ${sanitizeInput(jobTitle)}`;
    } catch (error) {
        console.error('Error fetching job chats:', error);
        content.innerHTML = `<p>Error loading chats.</p>`;
    }
}

function openFloatingChat(chatId, title) {
    activeChatId = chatId;
    document.getElementById('floatingChatWindow').style.display = 'flex';
    document.getElementById('floatingChatTitle').textContent = title;
    document.getElementById('floatingChatInput').style.display = 'block';
    document.getElementById('floatingSendBtn').style.display = 'block';
    listenToFloatingChat(chatId);
    document.getElementById('floatingChatInput').focus();
}

function listenToFloatingChat(chatId) {
    const content = document.getElementById('floatingChatContent');
    const user = firebase.auth().currentUser;
    if (unsubscribeChat) unsubscribeChat();

    unsubscribeChat = firebase.firestore().collection('Chats').doc(chatId)
        .onSnapshot(doc => {
            const chat = doc.data();
            content.innerHTML = ''; // Clear previous messages
            if (chat && chat.messages && !chat.deleted) {
                chat.messages.sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis()).forEach(msg => {
                    const isSender = msg.senderId === user.uid;
                    
                    const wrapper = document.createElement('div');
                    wrapper.className = `message-wrapper ${isSender ? 'sent' : 'received'}`;
                    
                    const senderName = document.createElement('div');
                    senderName.className = 'message-sender-name';
                    senderName.textContent = sanitizeInput(msg.sender);

                    const bubble = document.createElement('div');
                    bubble.className = 'message-bubble';
                    bubble.textContent = sanitizeInput(msg.text);
                    
                    wrapper.appendChild(senderName);
                    wrapper.appendChild(bubble);
                    content.appendChild(wrapper);
                });
                content.scrollTop = content.scrollHeight;
            } else {
                content.innerHTML = '<p>No messages yet. Start the conversation!</p>';
            }
        }, error => {
            console.error('Error listening to floating chat:', error);
            content.innerHTML = `<p>Error loading messages.</p>`;
        });
}

document.getElementById('floatingSendBtn').addEventListener('click', () => {
    const user = firebase.auth().currentUser;
    const messageText = sanitizeInput(document.getElementById('floatingChatInput').value.trim());
    if (!messageText || !activeChatId) return;

    const chatRef = firebase.firestore().collection('Chats').doc(activeChatId);
    chatRef.update({
        messages: firebase.firestore.FieldValue.arrayUnion({
            sender: sanitizeInput(user.displayName || 'User'),
            senderId: user.uid,
            text: messageText,
            timestamp: firebase.firestore.Timestamp.now()
        }),
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        document.getElementById('floatingChatInput').value = '';
        document.getElementById('floatingChatInput').focus();
    });
});

// --- NEW FUNCTION ---
function goBackToChatList() {
    const title = document.getElementById('floatingChatTitle').textContent;
    if (title === 'Your Chats' || title.startsWith('About: ') || title.startsWith('Chat with ')) {
        showAllWorkerChats();
    } else if (title === 'Your Jobs' || title.startsWith('Chats for: ')) {
        showAllOwnerJobs();
    }
}
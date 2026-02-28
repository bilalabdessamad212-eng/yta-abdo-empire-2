const byId = (id) => document.getElementById(id);

const els = {
    btnNewProject: byId('btn-new-project'),
    btnOpenFolder: byId('btn-open-folder'),
    btnOpenFile: byId('btn-open-file'),
    btnExit: byId('btn-exit'),
    status: byId('status'),
};

function setBusy(busy, message = '', kind = 'info') {
    [els.btnNewProject, els.btnOpenFolder, els.btnOpenFile].forEach((btn) => {
        if (btn) btn.disabled = busy;
    });
    if (els.status) {
        els.status.textContent = message;
        els.status.className = kind === 'error' ? 'status' : 'status info';
    }
}

function setError(message) {
    if (!els.status) return;
    els.status.textContent = message;
    els.status.className = 'status';
}

async function runAction(fn, busyText) {
    try {
        setBusy(true, busyText, 'info');
        const result = await fn();
        // When successful, main process closes this startup window automatically.
        if (!result || (!result.success && !result.cancelled)) {
            setBusy(false);
            setError(result?.error || 'Could not complete action.');
            return;
        }
        if (result.cancelled) {
            setBusy(false, '', 'info');
        }
    } catch (error) {
        setBusy(false);
        setError(error?.message || 'Unexpected error.');
    }
}

function init() {
    if (!window.electronAPI) {
        setError('Electron bridge is not available.');
        return;
    }

    els.btnNewProject?.addEventListener('click', () => runAction(
        () => window.electronAPI.startupCreateProject(),
        'Choose a location for your new project...'
    ));

    els.btnOpenFolder?.addEventListener('click', () => runAction(
        () => window.electronAPI.startupOpenProjectFolder(),
        'Select an existing project folder...'
    ));

    els.btnOpenFile?.addEventListener('click', () => runAction(
        () => window.electronAPI.startupOpenProjectFile(),
        'Select a .fvp project file...'
    ));

    els.btnExit?.addEventListener('click', async () => {
        await window.electronAPI.startupCancel();
    });

    window.addEventListener('keydown', async (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            await window.electronAPI.startupCancel();
        }
    });
}

init();

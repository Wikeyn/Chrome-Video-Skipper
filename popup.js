document.addEventListener('DOMContentLoaded', function() {
    const groupList = document.getElementById('groupList');
    const searchBox = document.getElementById('searchBox');
    const groupName = document.getElementById('groupName');
    const skip1Min = document.getElementById('skip1Min');
    const skip1Sec = document.getElementById('skip1Sec');
    const skip2Min = document.getElementById('skip2Min');
    const skip2Sec = document.getElementById('skip2Sec');
    const saveBtn = document.getElementById('saveBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const importBtn = document.getElementById('importBtn');
    const exportBtn = document.getElementById('exportBtn');
    const status = document.getElementById('status');

    let currentGroup = null;
    let groups = {};

    // 加载设置
    chrome.storage.local.get('groups', function(data) {
        groups = data.groups || {};
        updateGroupList();
    });

    // 格式化时间显示
    function formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}分${secs}秒`;
    }

    // 更新分组列表
    function updateGroupList(searchText = '') {
        groupList.innerHTML = '';
        
        // 分离置顶和未置顶的分组
        const pinnedGroups = [];
        const unpinnedGroups = [];
        
        Object.keys(groups).forEach(group => {
            if (group.toLowerCase().includes(searchText.toLowerCase())) {
                if (groups[group].pinned) {
                    pinnedGroups.push(group);
                } else {
                    unpinnedGroups.push(group);
                }
            }
        });

        // 按置顶时间排序
        pinnedGroups.sort((a, b) => (groups[b].pinnedTime || 0) - (groups[a].pinnedTime || 0));

        if (pinnedGroups.length === 0 && unpinnedGroups.length === 0) {
            groupList.innerHTML = '<div class="no-groups">no group,pls create a new one</div>';
            return;
        }

        // 渲染置顶分组
        pinnedGroups.forEach(group => {
            const div = createGroupItem(group);
            groupList.appendChild(div);
        });

        // 渲染未置顶分组
        unpinnedGroups.forEach(group => {
            const div = createGroupItem(group);
            groupList.appendChild(div);
        });
    }

    // 创建分组项
    function createGroupItem(group) {
        const settings = groups[group];
        const div = document.createElement('div');
        div.className = `group-item ${currentGroup === group ? 'selected' : ''}`;
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'group-name';
        nameSpan.textContent = group;
        
        const timesSpan = document.createElement('span');
        timesSpan.className = 'group-times';
        timesSpan.textContent = `skip1: ${formatTime(settings.skip1)} | skip2: ${formatTime(settings.skip2)}`;
        
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'group-actions';
        
        const pinButton = document.createElement('button');
        pinButton.className = `action-button pin ${settings.pinned ? 'active' : ''}`;
        pinButton.innerHTML = settings.pinned ? 'unpin' : 'pin2top';
        pinButton.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePin(group);
        });
        
        actionsDiv.appendChild(pinButton);
        
        div.appendChild(nameSpan);
        div.appendChild(timesSpan);
        div.appendChild(actionsDiv);
        
        div.onclick = () => selectGroup(group);
        
        return div;
    }

    // 切换置顶状态
    function togglePin(group) {
        if (!groups[group]) return;
        
        groups[group].pinned = !groups[group].pinned;
        if (groups[group].pinned) {
            groups[group].pinnedTime = Date.now();
        } else {
            delete groups[group].pinnedTime;
        }
        
        saveGroups();
        updateGroupList(searchBox.value);
    }

    // 选择分组
    function selectGroup(group) {
        currentGroup = group;
        const settings = groups[group];
        groupName.value = group;
        skip1Min.value = Math.floor(settings.skip1 / 60);
        skip1Sec.value = settings.skip1 % 60;
        skip2Min.value = Math.floor(settings.skip2 / 60);
        skip2Sec.value = settings.skip2 % 60;
        status.textContent = `selected: ${group}`;
        updateGroupList(searchBox.value);

        // 向 content script 发送当前选中的组
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: 'updateCurrentGroup',
                group: group
            });
        });
    }

    // 搜索功能
    searchBox.addEventListener('input', function() {
        updateGroupList(this.value);
    });

    // 保存设置
    saveBtn.onclick = function() {
        const name = groupName.value.trim();
        if (!name) {
            status.textContent = 'name the group';
            return;
        }

        const skip1 = parseInt(skip1Min.value) * 60 + parseInt(skip1Sec.value);
        const skip2 = parseInt(skip2Min.value) * 60 + parseInt(skip2Sec.value);

        // 如果是新分组，初始化置顶状态
        if (!groups[name]) {
            groups[name] = {
                skip1: skip1,
                skip2: skip2,
                pinned: false
            };
        } else {
            // 保留原有的置顶状态
            groups[name].skip1 = skip1;
            groups[name].skip2 = skip2;
        }

        saveGroups();
        currentGroup = name;
        updateGroupList(searchBox.value);
        status.textContent = `saved: ${name}`;
    };

    // 删除分组
    deleteBtn.onclick = function() {
        if (!currentGroup) {
            status.textContent = 'select the group to delete';
            return;
        }

        if (confirm(`delete the group ${currentGroup}?`)) {
            delete groups[currentGroup];
            saveGroups();
            currentGroup = null;
            groupName.value = '';
            skip1Min.value = 0;
            skip1Sec.value = 0;
            skip2Min.value = 0;
            skip2Sec.value = 0;
            updateGroupList(searchBox.value);
            status.textContent = 'group deleted';
        }
    };

    // 保存分组数据
    function saveGroups() {
        chrome.storage.local.set({ groups: groups });
    }

    // 导入设置
    importBtn.onclick = function() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = function(e) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const importedGroups = JSON.parse(e.target.result);
                    // 确保导入的分组有置顶属性
                    Object.keys(importedGroups).forEach(group => {
                        if (!importedGroups[group].hasOwnProperty('pinned')) {
                            importedGroups[group].pinned = false;
                        }
                    });
                    Object.assign(groups, importedGroups);
                    saveGroups();
                    updateGroupList(searchBox.value);
                    status.textContent = 'setting imported';
                } catch (error) {
                    status.textContent = 'import failed: file format error';
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    // 导出设置
    exportBtn.onclick = function() {
        const blob = new Blob([JSON.stringify(groups, null, 4)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'skip_settings.json';
        a.click();
        URL.revokeObjectURL(url);
        status.textContent = 'setting exported';
    };
}); 

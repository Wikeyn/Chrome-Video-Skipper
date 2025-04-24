let currentGroup = null;
let groups = {};
let lastTimeBeforeSkip = null;
let videoElement = null;
let videoObserver = null;
let maxRetryCount = 10; // 最大重试次数
let retryInterval = 1000; // 重试间隔（毫秒）

// 加载设置
chrome.storage.local.get('groups', function(data) {
    groups = data.groups || {};
    if (Object.keys(groups).length > 0) {
        // 优先选择置顶的分组
        const pinnedGroups = Object.entries(groups)
            .filter(([_, group]) => group.pinned)
            .sort((a, b) => (b[1].pinnedTime || 0) - (a[1].pinnedTime || 0));
        
        if (pinnedGroups.length > 0) {
            currentGroup = pinnedGroups[0][0];
        } else {
            currentGroup = Object.keys(groups)[0];
        }
        console.log('[Video Skipper] 已加载设置，当前组:', currentGroup);
    } else {
        console.log('[Video Skipper] 未找到任何分组设置');
    }
});

// 监听设置变化
chrome.storage.onChanged.addListener(function(changes) {
    if (changes.groups) {
        groups = changes.groups.newValue || {};
        // 更新当前分组，优先选择置顶的分组
        const pinnedGroups = Object.entries(groups)
            .filter(([_, group]) => group.pinned)
            .sort((a, b) => (b[1].pinnedTime || 0) - (a[1].pinnedTime || 0));
        
        if (pinnedGroups.length > 0) {
            currentGroup = pinnedGroups[0][0];
        } else if (Object.keys(groups).length > 0) {
            currentGroup = Object.keys(groups)[0];
        } else {
            currentGroup = null;
        }
        console.log('[Video Skipper] 设置已更新，当前组:', currentGroup);
    }
});

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'updateCurrentGroup') {
        currentGroup = request.group;
        console.log('[Video Skipper] 收到更新组消息，新组:', currentGroup);
    }
});

// 在 Shadow DOM 中查找视频元素
function findVideoInShadowDOM(element) {
    if (!element || !element.shadowRoot) return null;
    
    console.log('[Video Skipper] 在 Shadow DOM 中查找视频元素');
    
    // 检查当前 Shadow DOM
    const video = element.shadowRoot.querySelector('video');
    if (video) {
        console.log('[Video Skipper] 在 Shadow DOM 中找到视频元素');
        return video;
    }
    
    // 递归检查嵌套的 Shadow DOM
    const shadowElements = element.shadowRoot.querySelectorAll('*');
    for (const el of shadowElements) {
        if (el.shadowRoot) {
            const found = findVideoInShadowDOM(el);
            if (found) return found;
        }
    }
    
    return null;
}

// 在 iframe 中查找视频元素
function findVideoInIframes() {
    console.log('[Video Skipper] 在 iframe 中查找视频元素');
    
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
        try {
            // 确保 iframe 已加载且同源
            if (iframe.contentDocument) {
                console.log('[Video Skipper] 检查 iframe 内容');
                
                // 在 iframe 中查找视频
                const video = iframe.contentDocument.querySelector('video');
                if (video) {
                    console.log('[Video Skipper] 在 iframe 中找到视频元素');
                    return video;
                }
                
                // 检查 iframe 中的 Shadow DOM
                const shadowVideo = findVideoInShadowDOM(iframe.contentDocument.body);
                if (shadowVideo) return shadowVideo;
            }
        } catch (error) {
            console.log('[Video Skipper] 无法访问 iframe 内容:', error);
        }
    }
    
    return null;
}

// 获取当前网站特定的视频元素选择器
function getCurrentWebsiteData() {
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;
    
    // 网站特定的选择器配置
    const websiteConfigs = {
        'bilibili.com': {
            selectors: [
                '.bilibili-player video',
                '.bpx-player video',
                '.bilibili-player-video video',
                '.bpx-player-video video'
            ],
            customHandler: function() {
                // B站特殊处理
                const player = document.querySelector('.bilibili-player');
                if (player && player.__vue__) {
                    return player.__vue__.video;
                }
                return null;
            }
        },
        'iqiyi.com': {
            selectors: [
                '.iqiyi-player video',
                '.qy-player video',
                '.qy-player-container video'
            ],
            customHandler: function() {
                // 爱奇艺特殊处理
                const player = document.querySelector('.qy-player');
                if (player && player.player) {
                    return player.player.video;
                }
                return null;
            }
        },
        'youku.com': {
            selectors: [
                '.youku-player video',
                '.yk-player video',
                '.yk-player-container video'
            ],
            customHandler: function() {
                // 优酷特殊处理
                const player = document.querySelector('.yk-player');
                if (player && player.player) {
                    return player.player.video;
                }
                return null;
            }
        },
        'qq.com': {
            selectors: [
                '.txp-player video',
                '.txp-player-container video',
                '.txp-video video'
            ],
            customHandler: function() {
                // 腾讯视频特殊处理
                const player = document.querySelector('.txp-player');
                if (player && player.player) {
                    return player.player.video;
                }
                return null;
            }
        },
        'youtube.com': {
            selectors: [
                '.html5-video-player video',
                '.ytp-video video',
                '#movie_player video'
            ],
            customHandler: function() {
                // YouTube特殊处理
                const player = document.querySelector('#movie_player');
                if (player && player.getPlayerState) {
                    return player.querySelector('video');
                }
                return null;
            }
        }
    };
    
    // 返回当前网站的配置，如果没有匹配则返回默认配置
    return websiteConfigs[hostname] || {
        selectors: [
            'video',
            '.artplayer-video',
            '.video-player video',
            '.player video',
            '.media-player video',
            '[class*="video"] video',
            '[class*="player"] video'
        ],
        customHandler: null
    };
}

// 扩展的视频元素查找函数
function findVideoElement() {
    if (videoElement) {
        console.log('[Video Skipper] 使用缓存的视频元素');
        return videoElement;
    }

    console.log('[Video Skipper] 开始查找视频元素...');
    
    // 获取当前网站的特定配置
    const websiteData = getCurrentWebsiteData();
    
    // 1. 尝试网站特定的选择器
    for (const selector of websiteData.selectors) {
        const video = document.querySelector(selector);
        if (video) {
            console.log(`[Video Skipper] 通过选择器找到视频元素: ${selector}`);
            videoElement = video;
            return video;
        }
    }
    
    // 2. 尝试网站特定的自定义处理
    if (websiteData.customHandler) {
        const video = websiteData.customHandler();
        if (video) {
            console.log('[Video Skipper] 通过自定义处理找到视频元素');
            videoElement = video;
            return video;
        }
    }
    
    // 3. 尝试查找 ArtPlayer 实例
    const artPlayerContainers = document.querySelectorAll('.artplayer-app, [class*="artplayer"]');
    for (const container of artPlayerContainers) {
        if (container.art) {
            console.log('[Video Skipper] 找到 ArtPlayer 实例');
            videoElement = container.art.video;
            return container.art.video;
        }
    }
    
    // 4. 检查 Shadow DOM
    const shadowVideo = findVideoInShadowDOM(document.body);
    if (shadowVideo) {
        videoElement = shadowVideo;
        return shadowVideo;
    }
    
    // 5. 检查 iframes
    const iframeVideo = findVideoInIframes();
    if (iframeVideo) {
        videoElement = iframeVideo;
        return iframeVideo;
    }
    
    // 6. 尝试通过类名查找
    const elements = document.querySelectorAll('*');
    for (const element of elements) {
        if (element.tagName === 'VIDEO') {
            console.log('[Video Skipper] 通过遍历找到视频元素');
            videoElement = element;
            return element;
        }
    }
    
    console.log('[Video Skipper] 未找到视频元素');
    return null;
}

// 等待视频元素加载
function waitForVideoElement(callback) {
    let retryCount = 0;
    
    function tryFindVideo() {
        const video = findVideoElement();
        if (video) {
            console.log('[Video Skipper] 成功找到视频元素');
            callback(video);
            return;
        }
        
        retryCount++;
        if (retryCount >= maxRetryCount) {
            console.log('[Video Skipper] 达到最大重试次数，放弃查找');
            return;
        }
        
        console.log(`[Video Skipper] 第 ${retryCount} 次重试查找视频元素`);
        setTimeout(tryFindVideo, retryInterval);
    }
    
    tryFindVideo();
}

// 执行快进操作
function executeSkip(video, skipTime) {
    if (!video) return;
    
    // 记录当前位置
    lastTimeBeforeSkip = video.currentTime;
    console.log(`[Video Skipper] 记录当前位置: ${lastTimeBeforeSkip}秒`);
    
    // 尝试使用 ArtPlayer API
    const container = video.closest('.artplayer-app');
    if (container && container.art) {
        console.log('[Video Skipper] 使用ArtPlayer API快进');
        try {
            const currentTime = container.art.currentTime;
            container.art.seek = currentTime + skipTime;
            console.log(`[Video Skipper] ArtPlayer快进完成，新位置: ${container.art.currentTime}秒`);
            return;
        } catch (error) {
            console.log('[Video Skipper] ArtPlayer API调用失败，尝试使用原生API');
        }
    }
    
    // 使用原生video API
    console.log('[Video Skipper] 使用原生video API快进');
    try {
        video.currentTime += skipTime;
        console.log(`[Video Skipper] 原生API快进完成，新位置: ${video.currentTime}秒`);
    } catch (error) {
        console.log('[Video Skipper] 快进操作失败:', error);
    }
}

// 快进视频
function skipForward(skipType) {
    console.log(`[Video Skipper] 尝试执行快进操作，类型: ${skipType}`);
    
    if (!currentGroup || !groups[currentGroup]) {
        console.log('[Video Skipper] 错误：未选择分组或分组设置无效');
        return;
    }
    
    const skipTime = skipType === 1 ? groups[currentGroup].skip1 : groups[currentGroup].skip2;
    console.log(`[Video Skipper] 快进时间: ${skipTime}秒`);
    
    if (skipTime <= 0) {
        console.log('[Video Skipper] 错误：快进时间无效');
        return;
    }
    
    // 等待视频元素加载并执行快进
    waitForVideoElement(function(video) {
        executeSkip(video, skipTime);
    });
}

// 添加回退函数
function undoSkip() {
    console.log('[Video Skipper] 尝试执行回退操作');
    
    if (lastTimeBeforeSkip === null) {
        console.log('[Video Skipper] 错误：未记录回退位置');
        return;
    }
    
    // 等待视频元素加载并执行回退
    waitForVideoElement(function(video) {
        if (!video) {
            console.log('[Video Skipper] 错误：未找到视频元素');
            return;
        }
        
        console.log(`[Video Skipper] 回退到位置: ${lastTimeBeforeSkip}秒`);
        
        // 尝试使用 ArtPlayer API
        const container = video.closest('.artplayer-app');
        if (container && container.art) {
            console.log('[Video Skipper] 使用ArtPlayer API回退');
            try {
                container.art.seek = lastTimeBeforeSkip;
                console.log('[Video Skipper] ArtPlayer回退完成');
                lastTimeBeforeSkip = null;
                return;
            } catch (error) {
                console.log('[Video Skipper] ArtPlayer API调用失败，尝试使用原生API');
            }
        }
        
        // 使用原生video API
        console.log('[Video Skipper] 使用原生video API回退');
        try {
            video.currentTime = lastTimeBeforeSkip;
            console.log('[Video Skipper] 原生API回退完成');
            lastTimeBeforeSkip = null;
        } catch (error) {
            console.log('[Video Skipper] 回退操作失败:', error);
        }
    });
}

// 监听键盘事件
document.addEventListener('keydown', function(e) {
    console.log(`[Video Skipper] 检测到按键: ${e.key}`);
    
    if (e.key === '[') {
        console.log('[Video Skipper] 触发快进1');
        skipForward(1);
    } else if (e.key === ']') {
        console.log('[Video Skipper] 触发快进2');
        skipForward(2);
    } else if (e.key === '\\') {
        console.log('[Video Skipper] 触发回退');
        undoSkip();
    }
});

// 初始化视频元素监听
function initVideoObserver() {
    if (videoObserver) {
        videoObserver.disconnect();
    }

    videoObserver = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.addedNodes.length) {
                mutation.addedNodes.forEach(function(node) {
                    // 检查是否是video元素
                    if (node.tagName === 'VIDEO') {
                        videoElement = node;
                        console.log('Video element found');
                        return;
                    }
                    
                    // 检查是否是ArtPlayer相关元素
                    if (node.classList) {
                        if (node.classList.contains('artplayer-app') || 
                            node.classList.contains('artplayer-video')) {
                            // 延迟一小段时间确保ArtPlayer完全初始化
                            setTimeout(() => {
                                const video = findVideoElement();
                                if (video) {
                                    console.log('ArtPlayer video element found');
                                }
                            }, 500);
                        }
                    }
                });
            }
        });
    });

    // 开始观察整个文档
    videoObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// 每5秒尝试一次查找视频元素
setInterval(() => {
    if (!videoElement) {
        console.log('[Video Skipper] 定期检查：尝试查找视频元素');
        const video = findVideoElement();
        if (video) {
            console.log('[Video Skipper] 定期检查：找到视频元素');
        }
    }
}, 5000); 
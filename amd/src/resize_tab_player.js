/*
 * Position the Vimeo player within tab layout
 *
 * @package    mod_videotime
 * @module     mod_videotime/resize_tab_player
 * @copyright  2021 bdecent gmbh <https://bdecent.de>
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import Player from "mod_videotime/player";
import Notification from "core/notification";

let column;

/**
 * Intialize listener
 */
export const initialize = () => {
    var observer = new ResizeObserver(resize);
    document.querySelectorAll('.instance-container, div.videotime-tab-instance').forEach((container) => {
        observer.observe(container);
    });
    resize();
    document.querySelectorAll('.videotime-tab-instance').forEach((instance) => {
        instance.style.position = 'absolute';
    });

    window.removeEventListener('mousemove', mousemoveHandler);
    window.addEventListener('mousemove', mousemoveHandler);

    window.removeEventListener('dragstart', dragstartHandler);
    window.addEventListener('dragstart', dragstartHandler);

    window.removeEventListener('mouseup', dragendHandler);
    window.addEventListener('mouseup', dragendHandler);

    window.removeEventListener('click', cueVideo);
    window.addEventListener('click', cueVideo);
};

/**
 * Adjust player position when the page configuration is changed
 */
const resize = () => {
    document.querySelectorAll('.instance-container').forEach((container) => {
        if (!container.offsetWidth) {
            // Ignore if it is not visible.
            return;
        }
        container.closest('.videotimetabs').querySelectorAll('.videotime-tab-instance .vimeo-embed iframe').forEach((iframe) => {
            let instance = iframe.closest('.videotime-tab-instance');
            Object.assign(instance.style, {
                top: container.offsetTop + 'px',
                left: container.offsetLeft + 'px',
                width: container.offsetWidth + 'px'
            });
            container.style.minHeight = iframe.closest('.videotime-tab-instance').offsetHeight + 'px';
            document.querySelectorAll('.videotime-tab-instance-cover').forEach((cover) => {
                Object.assign(cover.style, {
                    top: instance.style.top,
                    left: instance.style.left,
                    width: instance.style.width,
                    height: instance.offsetHeight + 'px'
                });
            });
        });
    });
};

/**
 * Reset handle when drag ends
 */
const dragendHandler = () => {
    document.querySelectorAll('.videotime-tab-instance-cover').forEach((cover) => {
        cover.style.display = 'none';
    });
};

/**
 * Prepare to drag divider
 *
 * @param {event} e mouse event
 */
const dragstartHandler = (e) => {
    if (e.target.classList.contains('videotimetab-resize-handle')) {
        column = e.target.closest('.tab-pane').querySelector('.videotimetab-resize');
        e.stopPropagation();
        e.preventDefault();
        document.querySelectorAll('.videotime-tab-instance-cover').forEach((cover) => {
            cover.style.display = 'block';
        });
    }
};

/**
 * Resize the content and player to mouse location
 *
 * @param {event} e mouse event
 */
const mousemoveHandler = (e) => {
    document.querySelectorAll('.videotimetab-resize-handle').forEach((h) => {
        if (h.closest('.tab-pane') && document.querySelector('.videotime-tab-instance-cover').style.display == 'block') {
            column.style.width = e.pageX - column.getBoundingClientRect().left + 'px';
        }
    });
};

/**
 * Move video to new time when link clicked
 *
 * @param {event} e mouse event
 */
const cueVideo = (e) => {
    if (e.target.matches('[data-action="cue"]')) {
        let starttime = e.target.closest('a').getAttribute('data-start'),
            time = starttime.match(/((([0-9]+):)?(([0-9]+):))?([0-9]+(\.[0-9]+))/),
            iframe = e.target.closest('.videotimetabs').querySelector('.vimeo-embed iframe'),
            player = new Player(iframe);
        e.preventDefault();
        e.stopPropagation();
        if (time) {
            player.setCurrentTime(
                3600 * Number(time[3] || 0) + 60 * Number(time[5] || 0) + Number(time[6])
            ).then(player.play.bind(player)
            ).catch(Notification.exception);
        }
    }
};

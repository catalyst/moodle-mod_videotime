/*
 * @package    mod_videotime
 * @copyright  2021 bdecent gmbh <https://bdecent.de>
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * @module mod_videotime/videotime
 */
define([
    'jquery',
    'mod_videotime/player',
    'core/ajax',
    'core/config',
    'core/log',
    'core/templates',
    'core/notification'
], function($, Vimeo, Ajax, Config, Log, Templates, Notification) {
    let VideoTime = function(elementId, cmId, hasPro, interval, instance) {
        this.elementId = elementId;
        this.cmId = cmId;
        this.hasPro = hasPro;
        this.interval = interval;
        this.player = null;
        this.resumeTime = null;
        this.session = null;
        this.instance = instance;

        this.played = false;

        this.playing = false;
        this.time = 0;
        this.percent = 0;
        this.currentTime = 0;
        this.playbackRate = 1;

        this.plugins = [];

        if (hasPro && $('body').hasClass('path-course-view') && !$('body').hasClass('vtinit')) {
            $('body').addClass('vtinit');
            $(document).on('focus', 'body', this.initializeNewInstances.bind(this));
        }
        this.modulecount = $('body .activity.videotime').length;
    };

    /**
     * Get course module ID of this VideoTime instance.
     *
     * @return {int}
     */
    VideoTime.prototype.getCmId = function() {
        return this.cmId;
    };

    /**
     * Register a plugin to hook into VideoTime functionality.
     *
     * @param {VideoTimePlugin} plugin
     */
    VideoTime.prototype.registerPlugin = function(plugin) {
        this.plugins.push(plugin);
    };

    VideoTime.prototype.initialize = function() {
        let instance = this.instance;
        Log.debug('Initializing Video Time ' + this.elementId);

            Log.debug('Initializing Vimeo player with options:');
            Log.debug(instance);
            this.player = new Vimeo(this.elementId, {
                autopause: Number(instance.autopause),
                autoplay: Number(instance.autoplay),
                background: Number(instance.background),
                byline: Number(instance.byline),
                color: instance.color,
                controls: Number(instance.controls),
                dnt: Number(instance.dnt),
                height: instance.height,
                loop: Number(instance.option_loop),
                maxheight: instance.maxheight,
                maxwidth: instance.maxwidth,
                muted: Number(instance.muted),
                portrait: instance.portrait,
                pip: Number(instance.pip),
                playsinline: instance.playsinline,
                responsive: Number(instance.responsive),
                speed: instance.speed,
                title: Number(instance.title),
                transparent: Number(instance.transparent),
                url: instance.vimeo_url,
                width: instance.width
            });

            let url = new URL(window.location.href),
                q = url.searchParams.get('q'),
                starttime = (url.searchParams.get('time') || '').match(/^([0-9]+:){0,2}([0-9]+)(\.[0-9]+)$/);
            if (starttime) {
                this.setStartTime(starttime[0]).then(function() {
                    if (q && window.find) {
                        window.find(q);
                    }
                    return true;
                }).catch(Notification.exception);
            } else if (q && window.find) {
                window.find(q);
            }

            this.addListeners();

            for (let i = 0; i < this.plugins.length; i++) {
                const plugin = this.plugins[i];
                plugin.initialize(this, instance);
            }

            return true;
    };

    /**
     * Get Vimeo player object.
     *
     * @returns {Vimeo}
     */
    VideoTime.prototype.getPlayer = function() {
        return this.player;
    };

    /**
     * Register player events to respond to user interaction and play progress.
     */
    VideoTime.prototype.addListeners = function() {
        if (!this.player) {
            Log.debug('Player was not properly initialized for course module ' + this.cmId);
            return;
        }

        // If this is a tab play set time cues and listener.
        $($('#' + this.elementId).closest('.videotimetabs')).each(function(i, tabs) {
           $(tabs).find('[data-action="cue"]').each(function(index, anchor) {
                let starttime = anchor.getAttribute('data-start'),
                    time = starttime.match(/((([0-9]+):)?(([0-9]+):))?([0-9]+(\.[0-9]+))/);
                if (time) {
                    this.player.addCuePoint(
                        3600 * Number(time[3] || 0) + 60 * Number(time[5] || 0) + Number(time[6]),
                        {
                            starttime: starttime
                        }
                    ).catch(Notification.exeception);
                }
            }.bind(this));

            this.player.on('cuepoint', function(event) {
                if (event.data.starttime) {
                    $(tabs).find('.videotime-highlight').removeClass('videotime-highlight');
                    $(tabs).find('[data-action="cue"][data-start="' + event.data.starttime + '"]')
                        .closest('.row')
                        .addClass('videotime-highlight');
                    $('.videotime-highlight').each(function() {
                        if (this.offsetTop) {
                            this.parentNode.scrollTo({
                                top: this.offsetTop - 50,
                                left: 0,
                                behavior: 'smooth'
                            });
                        }
                    });
                }
            });
        }.bind(this));

        // Fire view event in Moodle on first play only.
        this.player.on('play', () => {
            if (this.hasPro) {
                this.startWatchInterval();
            }
            this.view();
            return true;
        });

        // Features beyond this point are for pro only.
        if (!this.hasPro) {
            return;
        }

        // If resume is present force seek the player to that point.
        this.player.on("loaded", () => {
            if (!this.instance.resume_playback || !this.instance.resume_time || this.instance.resume_time <= 0) {
                return true;
            }

            return this.getDuration().then((duration) => {
                let resumeTime = this.instance.resume_time;
                // Duration is often a little greater than a resume time at the end of the video.
                // A user may have watched 100 seconds when the video ends, but the duration may be
                // 100.56 seconds. BUT, sometimes the duration is rounded depending on when the
                // video loads, so it may be 101 seconds. Hence the +1 and Math.floor usage.
                if (resumeTime + 1 >= Math.floor(duration)) {
                    Log.debug(
                        "VIDEO_TIME video finished, resuming at start of video."
                    );
                    resumeTime = 0;
                }
                Log.debug("VIDEO_TIME duration is " + duration);
                Log.debug("VIDEO_TIME resuming at " + resumeTime);
                this.setCurrentPosition(resumeTime);
                return true;
            }).fail(Notification.exception);
        });

        // Note: Vimeo player does not support multiple events in a single on() call. Each requires it's own function.

        // Catch all events where video plays.
        this.player.on('play', function() {
            this.playing = true;
            Log.debug('VIDEO_TIME play');
        }.bind(this));
        this.player.on('playing', function() {
            this.playing = true;
            Log.debug('VIDEO_TIME playing');
        }.bind(this));

        // Catch all events where video stops.
        this.player.on('pause', function() {
            this.playing = false;
            Log.debug('VIDEO_TIME pause');
        }.bind(this));
        this.player.on('stalled', function() {
            this.playing = false;
            Log.debug('VIDEO_TIME stalled');
        }.bind(this));
        this.player.on('suspend', function() {
            this.playing = false;
            Log.debug('VIDEO_TIME suspend');
        }.bind(this));
        this.player.on('abort', function() {
            this.playing = false;
            Log.debug('VIDEO_TIME abort');
        }.bind(this));

        this.player.getPlaybackRate().then(function(playbackRate) {
            this.playbackRate = playbackRate;
        }.bind(this)).catch(Notification.exception);

        this.player.on('playbackratechange', function(event) {
            this.playbackRate = event.playbackRate;
        }.bind(this));

        // Always update internal values for percent and current time watched.
        this.player.on('timeupdate', function(event) {
            this.percent = event.percent;
            this.currentTime = event.seconds;
            if (event.seconds === event.duration) {
                this.plugins.forEach(plugin => {
                    if (typeof plugin.setCurrentTime == 'function') {
                        plugin.getSessions().then(session => {
                            plugin.setCurrentTime(session.id, event.seconds);
                            return session;
                        }).catch(Notification.exception);
                    }
                });
            }
        }.bind(this));

        // Initiate video finish procedure.
        this.player.on('ended', this.handleEnd.bind(this));
        this.player.on('pause', this.handlePause.bind(this));
    };

    /**
     * Handle pause
     */
    VideoTime.prototype.handlePause = function() {
        this.plugins.forEach(plugin => {
            if (typeof plugin.handlePause == 'function') {
                plugin.handlePause();
            }
        });
    };

    /**
     * Start interval that will periodically record user progress via Ajax.
     */
    VideoTime.prototype.handleEnd = function() {
        this.playing = false;
        Log.debug('VIDEO_TIME ended');
        if (this.plugins.length > 2) {
            this.plugins.forEach(plugin => {
                if (typeof plugin.handleEnd == 'function') {
                    plugin.handleEnd();
                }
            });
        } else {
            // This moved to pro plugin, but left for compatibility.
            this.getSession().then(function(session) {
                this.setSessionState(session.id, 1).then(() => {
                    return this.setPercent(session.id, 1);
                }).then(() => {
                    return this.setCurrentTime(session.id, this.currentTime);
                }).then(() => {
                    return this.getNextActivityButtonData(session.id).then(response => {
                        let data = JSON.parse(response.data);

                        if (data.instance && parseInt(data.instance.next_activity_auto)) {
                            if (!data.is_restricted && data.hasnextcm) {
                                let link = $('.aalink[href="' + data.nextcm_url + '"] img').first();
                                if ($('.path-course-view').length && link) {
                                    link.click();
                                } else {
                                    window.location.href = data.nextcm_url;
                                }
                            }
                        }

                        return Templates.render('videotime/next_activity_button', JSON.parse(response.data))
                            .then(function(html) {
                                $('#next-activity-button').html(html);
                                return true;
                            });
                    });
                }).catch(Notification.exception);
            }.bind(this)).catch(Notification.exception);
        }
    };

    /**
     * Start interval that will periodically record user progress via Ajax.
     */
    VideoTime.prototype.startWatchInterval = function() {
        this.plugins.forEach(plugin => {
            if (typeof plugin.startWatchInterval == 'function') {
                this.watchInterval = true;
                plugin.startWatchInterval();
            }
        });
        if (this.watchInterval) {
            return;
        }

        this.watchInterval = setInterval(function() {
            if (this.playing) {
                this.time += this.playbackRate;

                this.getSession().then(function(session) {
                    if (this.time % this.interval === 0) {
                        Log.debug('VIDEO_TIME watch_time: ' + this.time + '. percent: ' + this.percent);
                        this.recordWatchTime(session.id, this.time);
                        this.setPercent(session.id, this.percent);
                        this.setCurrentTime(session.id, this.currentTime);
                    }
                    return true;
                }.bind(this)).catch(Notification.exception);
            }
        }.bind(this), 1000);
    };

    /**
     * Set state on session.
     *
     * @param {int} sessionId
     * @param {int} state
     * @returns {Promise}
     */
    VideoTime.prototype.setSessionState = function(sessionId, state) {
        if (this.instance.token) {
            const url = new URL(Config.wwwroot + '/webservice/rest/server.php'),
                data = url.searchParams;
            data.set('wstoken', this.instance.token);
            data.set('moodlewsrestformat', 'json');
            data.set('wsfunction', 'videotimeplugin_pro_set_session_state');
            data.set('state', state);
            data.set('session_id', sessionId);
            return fetch(url).then((response) => {
                if (!response.ok) {
                    Notification.exeption('Web service error');
                }
                return response.json();
            });
        }

        return Ajax.call([{
            methodname: 'videotimeplugin_pro_set_session_state',
            args: {"session_id": sessionId, state: state},
            fail: Notification.exception
        }])[0];
    };

    /**
     * Set current watch time for video. Used for resuming.
     *
     * @param {int} sessionId
     * @param {float} currentTime
     * @returns {Promise}
     */
    VideoTime.prototype.setCurrentTime = function(sessionId, currentTime) {
        if (this.instance.token) {
            const url = new URL(Config.wwwroot + '/webservice/rest/server.php'),
                data = url.searchParams;
            data.set('wstoken', this.instance.token);
            data.set('moodlewsrestformat', 'json');
            data.set('wsfunction', 'videotimeplugin_pro_set_session_current_time');
            data.set('current_time', currentTime);
            data.set('session_id', sessionId);
            return fetch(url).then((response) => {
                if (!response.ok) {
                    Notification.exeption('Web service error');
                }
                return response.json();
            });
        }
        return Ajax.call([{
            methodname: 'videotimeplugin_pro_set_session_current_time',
            args: {"session_id": sessionId, "current_time": currentTime},
            fail: Notification.exception
        }])[0];
    };

    /**
     * Set video watch percentage for session.
     *
     * @param {int} sessionId
     * @param {float} percent
     * @returns {Promise}
     */
    VideoTime.prototype.setPercent = function(sessionId, percent) {
        if (this.instance.token) {
            const url = new URL(Config.wwwroot + '/webservice/rest/server.php'),
                data = url.searchParams;
            data.set('wstoken', this.instance.token);
            data.set('moodlewsrestformat', 'json');
            data.set('wsfunction', 'videotimeplugin_pro_set_percent');
            data.set('percent', percent);
            data.set('session_id', sessionId);
            return fetch(url).then((response) => {
                if (!response.ok) {
                    Notification.exeption('Web service error');
                }
                return response.json();
            });
        }
        return Ajax.call([{
            methodname: 'videotimeplugin_pro_set_percent',
            args: {"session_id": sessionId, percent: percent},
            fail: Notification.exception
        }])[0];
    };

    /**
     * Record watch time for session.
     *
     * @param {int} sessionId
     * @param {float} time
     * @returns {Promise}
     */
    VideoTime.prototype.recordWatchTime = function(sessionId, time) {
        if (this.instance.token) {
            const url = new URL(Config.wwwroot + '/webservice/rest/server.php'),
                data = url.searchParams;
            data.set('wstoken', this.instance.token);
            data.set('moodlewsrestformat', 'json');
            data.set('wsfunction', 'videotimeplugin_pro_record_watch_time');
            data.set('session_id', sessionId);
            data.set('time', time);
            return fetch(url).then((response) => {
                if (!response.ok) {
                    Notification.exeption('Web service error');
                }
                return response.json();
            });
        }
        return Ajax.call([{
            methodname: 'videotimeplugin_pro_record_watch_time',
            args: {"session_id": sessionId, time: time},
            fail: Notification.exception
        }])[0];
    };

    /**
     * Get data for next activity button.
     *
     * @param {int} sessionId
     * @returns {Promise}
     */
    VideoTime.prototype.getNextActivityButtonData = function(sessionId) {
        if (this.instance.token) {
            // We do not support button in iframe.
            return Promise.resolve({data: '{}'});
        }
        return Ajax.call([{
            methodname: 'videotimeplugin_pro_get_next_activity_button_data',
            args: {"session_id": sessionId}
        }])[0];
    };

    /**
     * Get VideoTime instance for this course module.
     *
     * @returns {Promise}
     */
    VideoTime.prototype.getInstance = function() {
        if (this.instance) {
            return Promise.resolve(this.instance);
        }

        return Ajax.call([{
            methodname: 'mod_videotime_get_videotime',
            args: {cmid: this.cmId},
            done: (response) => {
                this.instance = response;
                return this.instance;
            },
            fail: Notification.exception
        }])[0];
    };

    /**
     * Get time to resume video as seconds.
     *
     * @returns {Promise}
     */
    VideoTime.prototype.getResumeTime = function() {
        if (this.resumeTime) {
            return Promise.resolve(this.resumeTime);
        }

        return Ajax.call([{
            methodname: 'videotimeplugin_pro_get_resume_time',
            args: {cmid: this.cmId},
            done: (response) => {
                this.resumeTime = response.seconds;
                return this.resumeTime;
            },
            fail: Notification.exception
        }])[0];
    };

    /**
     * Get new or existing video viewing session.
     *
     * @returns {Promise}
     */
    VideoTime.prototype.getSession = function() {
        if (this.instance.token) {
            if (!this.session) {
                const url = new URL(Config.wwwroot + '/webservice/rest/server.php'),
                    data = url.searchParams;
                data.set('wstoken', this.instance.token);
                data.set('moodlewsrestformat', 'json');
                data.set('wsfunction', 'videotimeplugin_pro_get_new_session');
                data.set('cmid', this.cmId);
                this.session = fetch(url).then((response) => {
                    if (!response.ok) {
                        Notification.exeption('Web service error');
                    }
                    return response.json();
                });
            }

            return this.session;
        }
        if (!this.session) {
            this.session = Ajax.call([{
                methodname: 'videotimeplugin_pro_get_new_session',
                args: {cmid: this.cmId},
                fail: Notification.exception
            }])[0];
        }
        return this.session;
    };

    /**
     * Parse start time and set player
     *
     * @param {string} starttime
     * @returns {Promise}
     */
    VideoTime.prototype.setStartTime = function(starttime) {
        let time = starttime.match(/((([0-9]+):)?(([0-9]+):))?([0-9]+(\.[0-9]+))/);
        if (time) {
            this.resumeTime = 3600 * Number(time[3] || 0) + 60 * Number(time[5] || 0) + Number(time[6]);
            this.currentTime(this.resumeTime);
        }
        return this.player.getCurrentTime();
    };

    /**
     * Log the user view of video.
     *
     * @returns {Promise}
     */
    VideoTime.prototype.view = function() {
        if (this.instance.token) {
            const url = new URL(Config.wwwroot + '/webservice/rest/server.php'),
                data = url.searchParams;
            data.set('wstoken', this.instance.token);
            data.set('moodlewsrestformat', 'json');
            data.set('wsfunction', 'mod_videotime_view_videotime');
            data.set('cmid', this.cmId);
            return fetch(url).then((response) => {
                if (!response.ok) {
                    Notification.exeption('Web service error');
                }
                return response.json();
            });

        }
        return Ajax.call([{
            methodname: 'mod_videotime_view_videotime',
            args: {cmid: this.cmId},
            fail: Notification.exception
        }])[0];
    };

    /**
     * Initialize new labels and preview when editing
     */
    VideoTime.prototype.initializeNewInstances = function() {
        if (this.modulecount == $('body .activity.videotime').length) {
            return;
        }
        this.modulecount = $('body .activity.videotime').length;
        $('body .activity.videotime').each(function(index, module) {
            if (
                !$(module).find('.instancename').length
                && $(module).find('.vimeo-embed').length
                && !$(module).find('.vimeo-embed iframe').length
            ) {
                let instance = {
                    cmid: Number($(module).attr('id').replace('module-', '')),
                    haspro: true,
                    interval: this.interval,
                    uniqueid: $(module).find('.vimeo-embed').first().attr('id').replace('vimeo-embed-', '')
                };
                Templates.render('mod_videotime/videotime_instance', {
                    instance: instance
                }).then(function(html, js) {
                    Templates.runTemplateJS(js);
                    return true;
                }).fail(Notification.exception);
            }
        }.bind(this));
    };

    /**
     * Get play back rate
     *
     * @returns {Promise}
     */
    VideoTime.prototype.getPlaybackRate = function() {
        return this.player.getPlaybackRate();
    };

    /**
     * Get duration of video
     *
     * @returns {Promise}
     */
    VideoTime.prototype.getDuration = function() {
        return this.player.getDuration();
    };

    /**
     * Set current time of player
     *
     * @param {float} secs time
     * @returns {Promise}
     */
    VideoTime.prototype.setCurrentPosition = function(secs) {
        return this.player.setCurrentTime(secs);
    };

    /**
     * Get current time of player
     *
     * @returns {Promise}
     */
    VideoTime.prototype.getCurrentPosition = function() {
        return this.player.getCurrentTime();
    };

    return VideoTime;
});

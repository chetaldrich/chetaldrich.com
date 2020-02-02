---
title: Unleashing the Infinite Power of Thumbs
date: 2015-08-24
tags: ["pandora", "software"]
draft: false
---

Imagine for a moment that you're listening to Pandora and you thumb a track. What happens then? Obviously, there's the secret sauce that Pandora uses to get you that next song. Because the [#nextsongmatters](https://www.youtube.com/watch?v=lngTK6E9VsI). However, there's another service provided by Pandora that uses those thumbs as a part of a platform from which they can speak with you, the listener.

Appropriately, the platform is called [AMP](http://amp.pandora.com), and I got a chance to work on it this summer as a Software Engineer Intern.

You'd never really think about it, but there's a lot happening when you click that thumb. Somewhere, off in a server cluster
somewhere, it logs that thumb along with your reported age, location, and gender, along with the artist, the song, the time, and what you happened to think of that song at that moment.

Then, someone like me has to figure out how to take more than 50 billion thumbs and find a way to recommend songs that an artist could play in different regions of the US based on all of that feedback.

![50 Billion](/assets/posts/2015-08-25-thumbs/fifty_billion.jpg)

Of course, combing through all that wasn't easy. It did, however, teach me about the realities of working at scale. While working on projects at Carleton, even projects that were specifically dealing with lots of data were only dealing with tens of thousands of data points. Here I was manipulating data on the scale of millions.

Initially, these problems felt like they could be solved by using a bit of algorithmic know-how I gained from my classes, but the problems were usually of a different flavor. They required a way to be distributed across a cluster of computers. Often it was a short back of the envelope calculation that made me realize that some of the computations I had originally designated to be done when the user asked for them were simply not feasible when I increased the amount of data I was dealing with. For some of the more popular artists, dealing with a month's worth of feedback instead of a few days' worth could increase the amount of data that needed to be sifted through by several orders of magnitude.

This usually left me redesigning my whole system for the umpteenth time, but it made me respect the amount of data users can generate, and how this can be used to the artists' benefit. It means an artist can now directly reach out to you based on your tastes and analyze wide reaching trends about his or her music at the touch of a button.

At Pandora we talk about our goal to unleash the infinite power of music. This summer I learned quite a bit about how much can be done by unleashing the infinite power of thumbs.

![Thumb All The Things](/assets/posts/2015-08-25-thumbs/thumb_all_the_things.png)

So go ahead and give [Pandora](http://www.pandora.com) a listen. And make sure to give the artists a thumbs up if you like the music. Heck, thumb them all if you have the inclination.

You might just help your favorite artists in ways you wouldn't expect.

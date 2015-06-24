//= require "jquery"
//= require "modernizr"
//= require "bootstrap"
//= require "skillbar"

// creates scroll on click from down arrow on the home page
$(document).ready(function() {

    var imgs = ["banner1.jpg","banner2.jpg","banner3.jpg","banner4.jpg", "banner5.jpg"];
    var rand = Math.round(Math.random() * (imgs.length - 1))

    $(".banner").css({'background-image' : 'url(/images/' + imgs[rand] + ')'});


    $(".down_arrow").click(function() {
        $("body").animate({ scrollTop: $('#about').offset().top }, 1000);
    });

    $(".projects_link").click(function() {
        $("body").animate({ scrollTop: $('#projects').offset().top }, 1000);
    });

    $(".contact_link").click(function() {
        $("body").animate({ scrollTop: $('#contact').offset().top }, 1000);
        $(".envelope").delay(1000).animate({ fontSize: "120px" }, 1500);
        $(".envelope").animate({ fontSize: "100px" }, 1500);
    });

});

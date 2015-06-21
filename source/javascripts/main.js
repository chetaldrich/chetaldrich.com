//= require "jquery"
//= require "modernizr"
//= require "bootstrap"
//= require "skillbar"

// creates scroll on click from down arrow on the home page
$(document).ready(function() {
    $(".down_arrow").click(function() {
        $("body").animate({ scrollTop: $('#about').offset().top }, 1000);
    });
});

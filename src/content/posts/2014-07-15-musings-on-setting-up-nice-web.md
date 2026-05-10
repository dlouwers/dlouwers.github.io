---
title: Musings on setting up a nice web application structure using Spray and ScalaJS
date: 2014-07-15
summary: Notes on splitting frontend (ScalaJS) and backend (Spray) into separate SBT subprojects so the backend jar doesn't drag generated JS classes along.
tags: [spray, sbt, scalajs, scala]
---

Today I have been experimenting with setting up a nice project structure for web
applications using Spray and ScalaJS. First I considered the simplest option of
combining them in a single SBT project but this seems to be a bad idea. ScalaJS
generates class files and a jar. Mixing this with Scala backend code would
result in a bloated jar full of unused code.

So the next step is using two sub projects inside of SBT. One for the frontend
and one for the backend. However, in itself this is not enough. I would like my
html to reside in the frontend resources. The Javascript will be generated in
this project by fullOptJS and fastOptJS and end up in the project's target
directory. I'd like the generated Javascript and mapping files to be available
in resources. The backend project should have these resources available but NOT
the classes.

Next up I will be trying to see if this can be accomplished or if there is a
better way to go about this.
